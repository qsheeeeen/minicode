/**
 * Simple logging utility with emoji prefixes
 */

export function system(message: string): void {
  console.log(`ℹ️  ${message}`);
}

export function toolCall(message: string): void {
  console.log(`🔧 ${message}`);
}

export function toolResult(message: string): void {
  console.log(`📤 ${message}`);
}

export function error(message: string): void {
  console.log(`❌ ${message}`);
}

export function progress(message: string): void {
  process.stdout.write(`⏳ ${message}`);
}

export function raw(message: string): void {
  console.log(message);
}
