// Test module to verify reimport behavior
console.log("MODULE EXECUTED AT:", new Date().toISOString());

let counter = 0;
export const testLine1 = (counter++, console.log("Line 1 executed, counter:", counter));
export const testLine2 = (console.log("Line 2 executed"));
export const myVar = 42;
