import Foundation

#if os(macOS)
var data = Data()
while true {
  let chunk = FileHandle.standardInput.availableData
  if chunk.isEmpty { break }
  data.append(chunk)
}

if let value = NSUnarchiver.unarchiveObject(with: data) as? NSAttributedString {
  print(value.string)
  exit(0)
}

if let value = NSUnarchiver.unarchiveObject(with: data) as? String {
  print(value)
  exit(0)
}

fputs("unable to decode attributedBody\n", stderr)
exit(65)
#else
fputs("iMessage attributedBody decoding is macOS-only\n", stderr)
exit(69)
#endif
