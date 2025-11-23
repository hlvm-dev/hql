# HQL Homebrew Formula
# To use this formula:
# 1. Create a tap: brew tap hlvm-dev/hql
# 2. Or install directly: brew install hlvm-dev/hql/hql

class Hql < Formula
  desc "HQL - A modern Lisp-like language that transpiles to JavaScript"
  homepage "https://github.com/hlvm-dev/hlvm"
  version "0.1.0"

  # Platform-specific binaries
  if OS.mac?
    if Hardware::CPU.arm?
      url "https://github.com/hlvm-dev/hlvm/releases/download/v#{version}/hql-mac-arm"
      sha256 "REPLACE_WITH_ACTUAL_SHA256_FOR_MAC_ARM"  # TODO: Update after first release
    else
      url "https://github.com/hlvm-dev/hlvm/releases/download/v#{version}/hql-mac-intel"
      sha256 "REPLACE_WITH_ACTUAL_SHA256_FOR_MAC_INTEL"  # TODO: Update after first release
    end
  elsif OS.linux?
    url "https://github.com/hlvm-dev/hlvm/releases/download/v#{version}/hql-linux"
    sha256 "REPLACE_WITH_ACTUAL_SHA256_FOR_LINUX"  # TODO: Update after first release
  end

  def install
    # Rename downloaded binary to 'hql' and install to bin
    bin.install Dir["hql-*"].first => "hql"
  end

  test do
    # Test that hql binary works
    system "#{bin}/hql", "--version"

    # Test a simple HQL program
    (testpath/"test.hql").write "(print \"Hello from HQL!\")"
    assert_match "Hello from HQL!", shell_output("#{bin}/hql run #{testpath}/test.hql")
  end
end
