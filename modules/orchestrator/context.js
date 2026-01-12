export function validateParams(params, schema) {
  const errors = [];
  if (schema.required) {
    for (const field of schema.required) {
      if (!(field in params) || params[field] === undefined) errors.push(`Missing required field: ${field}`);
    }
  }
  if (schema.properties) {
    for (const [key, prop] of Object.entries(schema.properties)) {
      if (key in params && params[key] !== undefined) {
        const v = params[key], t = prop.type;
        if (t === 'string' && typeof v !== 'string') errors.push(`Field ${key} must be a string`);
        else if (t === 'number' && typeof v !== 'number') errors.push(`Field ${key} must be a number`);
        else if (t === 'boolean' && typeof v !== 'boolean') errors.push(`Field ${key} must be a boolean`);
        else if (t === 'array' && !Array.isArray(v)) errors.push(`Field ${key} must be an array`);
        else if (t === 'object' && (typeof v !== 'object' || Array.isArray(v))) errors.push(`Field ${key} must be an object`);
      }
    }
  }
  return { valid: errors.length === 0, errors };
}
