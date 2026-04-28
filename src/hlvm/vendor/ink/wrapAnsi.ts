import wrapAnsiNpm from 'wrap-ansi'

type WrapAnsiOptions = {
  hard?: boolean
  wordWrap?: boolean
  trim?: boolean
}

type BunWrapAnsi = {
  wrapAnsi?: (str: string, width: number, options?: WrapAnsiOptions) => string
}

const bunCompat = globalThis as typeof globalThis & { Bun?: BunWrapAnsi }

const wrapAnsiBun =
  typeof bunCompat.Bun?.wrapAnsi === 'function'
    ? bunCompat.Bun.wrapAnsi
    : null

const wrapAnsi: (
  input: string,
  columns: number,
  options?: WrapAnsiOptions,
) => string = wrapAnsiBun ?? wrapAnsiNpm

export { wrapAnsi }
