const { z } = require("zod");

const decimalStringSchema = z
  .string()
  .trim()
  .regex(/^\d+(\.\d+)?$/, "Value must be a decimal string")
  .refine((v) => !(v.startsWith("0") && v !== "0" && !v.startsWith("0.")), {
    message: "Value has invalid leading zeros"
  })
  .refine((v) => v !== "0" && !/^0\.0+$/.test(v), {
    message: "Value must be positive"
  })
  .refine((v) => v.length <= 80, {
    message: "Value is too large"
  });

const positiveIntegerStringSchema = z
  .string()
  .trim()
  .regex(/^\d+$/, "Value must be an integer string")
  .refine((v) => !(v.startsWith("0") && v !== "0"), {
    message: "Value has invalid leading zeros"
  })
  .refine((v) => v !== "0", {
    message: "Value must be positive"
  });

module.exports = {
  decimalStringSchema,
  positiveIntegerStringSchema
};
