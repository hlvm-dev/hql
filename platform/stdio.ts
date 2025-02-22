// platform/stdio.ts
export async function readLineFromStdin(): Promise<string | null> {
    const buf = new Uint8Array(1024);
    const n = await Deno.stdin.read(buf);
    if (n === null) return null;
    return new TextDecoder().decode(buf.subarray(0, n)).replace(/\r?\n$/, "");
  }
  
  export async function writeToStdout(text: string): Promise<void> {
    await Deno.stdout.write(new TextEncoder().encode(text));
  }
  