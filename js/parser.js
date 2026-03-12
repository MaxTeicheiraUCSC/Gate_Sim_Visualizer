// GATE simulation script parser
// Extracts volumes, sources, and unit definitions using regex + simple expression evaluation

const GATE_UNITS = {
  mm: 1.0, cm: 10.0, m: 1000.0, um: 0.001, nm: 1e-6,
  keV: 1.0, MeV: 1000.0, eV: 0.001, GeV: 1e6,
  deg: 1.0, rad: 57.29578,
  s: 1.0, ms: 0.001, us: 1e-6, ns: 1e-9,
  Bq: 1.0, kBq: 1000.0, MBq: 1e6,
};

export class Volume {
  constructor(name, volType) {
    this.name = name;
    this.volType = volType; // "Box" or "Sphere"
    this.size = [0, 0, 0];
    this.translation = [0, 0, 0];
    this.material = "G4_AIR";
    this.mother = null;
  }

  get radius() {
    return this.size[0] / 2.0;
  }

  bounds(parentOffset) {
    let cx = this.translation[0];
    let cy = this.translation[1];
    let cz = this.translation[2];
    if (parentOffset) {
      cx += parentOffset[0];
      cy += parentOffset[1];
      cz += parentOffset[2];
    }
    if (this.volType === "Sphere") {
      const r = this.radius;
      return [cx - r, cx + r, cy - r, cy + r, cz - r, cz + r];
    }
    const hx = this.size[0] / 2, hy = this.size[1] / 2, hz = this.size[2] / 2;
    return [cx - hx, cx + hx, cy - hy, cy + hy, cz - hz, cz + hz];
  }
}

export class Source {
  constructor(name) {
    this.name = name;
    this.position = [0, 0, 0];
    this.energyKeV = 662.0;
    this.particle = "gamma";
  }
}

export class GeometryExtractor {
  constructor() {
    this.env = {};       // variable name -> numeric value
    this.volumes = {};   // volume name -> Volume
    this.sources = {};   // source name -> Source
    this.varToVol = {};  // python var -> volume name
    this.varToSrc = {};  // python var -> source name
  }

  extract(scriptText) {
    const lines = scriptText.split("\n");

    for (const rawLine of lines) {
      const line = rawLine.trim();
      if (!line || line.startsWith("#") || line.startsWith("import") || line.startsWith("from")) continue;
      this._processLine(line);
    }

    this._resolveGlobalPositions();
    return {
      volumes: Object.values(this.volumes),
      sources: Object.values(this.sources),
    };
  }

  _processLine(line) {
    // Strip inline comments (but not inside strings)
    line = line.replace(/#(?=(?:[^"']*["'][^"']*["'])*[^"']*$).*$/, "").trim();
    if (!line || !line.includes("=")) return;

    // Match: var = sim.add_volume("Box", name="xxx")
    let m = line.match(/^(\w+)\s*=\s*\w+\.add_volume\(\s*"(\w+)"\s*,\s*name\s*=\s*"([^"]+)"\s*\)/);
    if (m) {
      const [, varName, volType, volName] = m;
      this.volumes[volName] = new Volume(volName, volType);
      this.varToVol[varName] = volName;
      return;
    }

    // Match: var = sim.add_source("GenericSource", name="xxx")
    m = line.match(/^(\w+)\s*=\s*\w+\.add_source\(\s*"(\w+)"\s*,\s*name\s*=\s*"([^"]+)"\s*\)/);
    if (m) {
      const [, varName, , srcName] = m;
      this.sources[srcName] = new Source(srcName);
      this.varToSrc[varName] = srcName;
      return;
    }

    // Match: var = sim.world
    m = line.match(/^(\w+)\s*=\s*\w+\.world\b/);
    if (m) {
      const varName = m[1];
      if (!this.volumes["world"]) {
        this.volumes["world"] = new Volume("world", "Box");
        this.volumes["world"].size = [500, 500, 500];
        this.volumes["world"].material = "G4_AIR";
      }
      this.varToVol[varName] = "world";
      return;
    }

    // Match: unit = gate.g4_units.mm
    m = line.match(/^(\w+)\s*=\s*\w+\.g4_units\.(\w+)\s*$/);
    if (m) {
      const [, varName, unitName] = m;
      if (GATE_UNITS[unitName] !== undefined) {
        this.env[varName] = GATE_UNITS[unitName];
      }
      return;
    }

    // Match: obj.attr.subattr = expr (e.g. source.energy.mono = 662 * keV)
    m = line.match(/^(\w+)\.(\w+)\.(\w+)\s*=\s*(.+)$/);
    if (m) {
      const [, objVar, parentAttr, attr, exprStr] = m;
      if (this.varToSrc[objVar]) {
        const src = this.sources[this.varToSrc[objVar]];
        const val = this._evalExpr(exprStr.trim());
        if (val !== null) {
          if (parentAttr === "energy" && attr === "mono") src.energyKeV = val;
          else if (parentAttr === "position" && attr === "translation") src.position = val;
        }
      }
      return;
    }

    // Match: obj.attr = expr (e.g. det.size = [5, 10, 2])
    m = line.match(/^(\w+)\.(\w+)\s*=\s*(.+)$/);
    if (m) {
      const [, objVar, attr, exprStr] = m;

      if (this.varToVol[objVar]) {
        const vol = this.volumes[this.varToVol[objVar]];
        const val = this._evalExpr(exprStr.trim());
        if (val !== null) this._setVolumeAttr(vol, attr, val);
        return;
      }

      if (this.varToSrc[objVar]) {
        const src = this.sources[this.varToSrc[objVar]];
        const val = this._evalExpr(exprStr.trim());
        if (val !== null && attr === "particle") src.particle = val;
        return;
      }
    }

    // Match: simple assignment var = expr
    m = line.match(/^(\w+)\s*=\s*(.+)$/);
    if (m) {
      const [, varName, exprStr] = m;
      // Skip function definitions, class definitions, etc.
      if (["def", "class", "if", "for", "while", "return", "with", "try"].includes(varName)) return;
      const val = this._evalExpr(exprStr.trim());
      if (val !== null) {
        this.env[varName] = val;
      }
    }
  }

  _evalExpr(expr) {
    // String literal
    let m = expr.match(/^"([^"]*)"$/);
    if (m) return m[1];
    m = expr.match(/^'([^']*)'$/);
    if (m) return m[1];

    // List/tuple: [expr, expr, expr]
    m = expr.match(/^\[(.+)\]$/);
    if (!m) m = expr.match(/^\((.+)\)$/);
    if (m) {
      const items = this._splitCommas(m[1]);
      const vals = items.map(item => this._evalExpr(item.trim()));
      if (vals.some(v => v === null)) return null;
      return vals;
    }

    // Try arithmetic evaluation
    return this._evalArith(expr);
  }

  _splitCommas(str) {
    // Split by commas, respecting nested brackets
    const result = [];
    let depth = 0;
    let current = "";
    for (const ch of str) {
      if (ch === "[" || ch === "(") depth++;
      else if (ch === "]" || ch === ")") depth--;
      if (ch === "," && depth === 0) {
        result.push(current);
        current = "";
      } else {
        current += ch;
      }
    }
    if (current.trim()) result.push(current);
    return result;
  }

  _evalArith(expr) {
    expr = expr.trim();

    // Number literal
    if (/^-?\d+(\.\d+)?(e[+-]?\d+)?$/i.test(expr)) {
      return parseFloat(expr);
    }

    // Variable reference
    if (/^\w+$/.test(expr)) {
      if (this.env[expr] !== undefined) return this.env[expr];
      if (GATE_UNITS[expr] !== undefined) return GATE_UNITS[expr];
      return null;
    }

    // gate.g4_units.xxx
    const unitMatch = expr.match(/\w+\.g4_units\.(\w+)/);
    if (unitMatch && GATE_UNITS[unitMatch[1]] !== undefined) {
      return GATE_UNITS[unitMatch[1]];
    }

    // Unary minus
    if (expr.startsWith("-")) {
      const val = this._evalArith(expr.slice(1));
      return val !== null ? -val : null;
    }

    // Binary operations: find the lowest-precedence operator outside parens
    // Try +/- first (lowest precedence), then *//, scanning right to left
    for (const ops of [["+", "-"], ["*", "/"]]) {
      let depth = 0;
      for (let i = expr.length - 1; i >= 0; i--) {
        const ch = expr[i];
        if (ch === ")" || ch === "]") depth++;
        else if (ch === "(" || ch === "[") depth--;
        if (depth === 0 && ops.includes(ch)) {
          // Make sure it's not a unary minus (preceded by another operator or at start)
          if (ch === "-" && (i === 0 || /[+\-*/(\[]/.test(expr[i - 1]))) continue;
          const left = this._evalArith(expr.slice(0, i));
          const right = this._evalArith(expr.slice(i + 1));
          if (left === null || right === null) return null;
          switch (ch) {
            case "+": return left + right;
            case "-": return left - right;
            case "*": return left * right;
            case "/": return right !== 0 ? left / right : null;
          }
        }
      }
    }

    // Parenthesized expression
    if (expr.startsWith("(") && expr.endsWith(")")) {
      return this._evalArith(expr.slice(1, -1));
    }

    return null;
  }

  _setVolumeAttr(vol, attr, val) {
    switch (attr) {
      case "size":
        vol.size = Array.isArray(val) ? val : [val, val, val];
        break;
      case "translation":
        vol.translation = Array.isArray(val) ? val : [0, 0, val];
        break;
      case "material":
        vol.material = val;
        break;
      case "mother":
        vol.mother = val;
        break;
    }
  }

  _resolveGlobalPositions() {
    for (const vol of Object.values(this.volumes)) {
      if (vol.mother && this.volumes[vol.mother]) {
        const parent = this.volumes[vol.mother];
        vol.translation = [
          vol.translation[0] + parent.translation[0],
          vol.translation[1] + parent.translation[1],
          vol.translation[2] + parent.translation[2],
        ];
      }
    }
  }
}
