export type Value = number | Uint8Array
export type Message = Map<number, Value[]>

const decoder = new TextDecoder()

export function decode(buf: Uint8Array): Message | undefined {
  const out: Message = new Map()
  const end = buf.length
  let i = 0
  const varint = () => {
    let value = 0
    let scale = 1
    for (;;) {
      if (i >= end) throw new RangeError("truncated varint")
      const byte = buf[i++]
      value += (byte & 0x7f) * scale
      scale *= 128
      if (byte < 128) return value
    }
  }
  try {
    while (i < end) {
      const key = varint()
      const field = Math.floor(key / 8)
      const wire = key % 8
      let value: Value
      if (wire === 0) value = varint()
      else if (wire === 2) {
        const len = varint()
        value = buf.subarray(i, i + len)
        i += len
      } else if (wire === 1 || wire === 5) {
        const len = wire === 1 ? 8 : 4
        value = buf.subarray(i, i + len)
        i += len
      } else return undefined
      if (field === 0 || i > end) return undefined
      const list = out.get(field)
      if (list) list.push(value)
      else out.set(field, [value])
    }
  } catch {
    return undefined
  }
  return out
}

const bytes = (m: Message | undefined, field: number) => (m?.get(field) ?? []).filter((v): v is Uint8Array => v instanceof Uint8Array)

export const msg = (m: Message | undefined, field: number) => {
  const first = bytes(m, field)[0]
  return first ? decode(first) : undefined
}

export const msgs = (m: Message | undefined, field: number) =>
  bytes(m, field).map(decode).filter((x): x is Message => x !== undefined)

export const str = (m: Message | undefined, field: number) => {
  const first = bytes(m, field)[0]
  return first ? decoder.decode(first) : undefined
}

export const num = (m: Message | undefined, field: number) => {
  const first = m?.get(field)?.[0]
  return typeof first === "number" ? first : undefined
}

export const millis = (m: Message | undefined, field: number) => {
  const stamp = msg(m, field)
  const secs = num(stamp, 1)
  if (secs === undefined && num(stamp, 2) === undefined) return undefined
  return (secs ?? 0) * 1000 + Math.floor((num(stamp, 2) ?? 0) / 1e6)
}
