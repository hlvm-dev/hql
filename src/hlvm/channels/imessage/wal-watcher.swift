import Foundation

#if os(macOS)
if CommandLine.arguments.count < 2 {
  fputs("usage: wal-watcher <path>\n", stderr)
  exit(64)
}

let path = CommandLine.arguments[1]
let fd = open(path, O_EVTONLY)
if fd < 0 {
  fputs("failed to open WAL: \(path)\n", stderr)
  exit(66)
}

let queue = DispatchQueue(label: "dev.hlvm.imessage.wal-watcher")
let source = DispatchSource.makeFileSystemObjectSource(
  fileDescriptor: fd,
  eventMask: [.write, .extend, .delete, .rename, .revoke],
  queue: queue
)

source.setEventHandler {
  print("{\"event\":\"change\"}")
  fflush(stdout)

  let flags = source.data
  if flags.contains(.delete) || flags.contains(.rename) || flags.contains(.revoke) {
    source.cancel()
  }
}

source.setCancelHandler {
  close(fd)
  exit(0)
}

source.resume()
dispatchMain()
#else
fputs("iMessage WAL watcher is macOS-only\n", stderr)
exit(69)
#endif
