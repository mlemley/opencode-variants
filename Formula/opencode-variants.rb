# TODO before publishing: replace url/homepage with the real release archive once
# the repo lands on GitHub/GitLab. Local testing uses the file:// tarball built by:
#   git archive --format=tar.gz --prefix=opencode-variants-<version>/ \
#     -o /tmp/opencode-variants-<version>.tar.gz HEAD
class OpencodeVariants < Formula
  desc "Per-directory OpenCode model routing (cloud/hybrid/all-local) via generated direnv configs"
  version "0.2.0"
  homepage "https://example.invalid/opencode-variants" # TODO real homepage
  url "file:///tmp/opencode-variants-0.2.0.tar.gz"
  sha256 "8e125bac06768f52cbd2ab0f6b1719522b16f12bfda27b7696d91af2ad689a12"

  depends_on "direnv"
  depends_on "node"

  def install
    libexec.install Dir["*"]
    (bin/"ov").write <<~EOS
      #!/bin/bash
      exec "#{Formula["node"].opt_bin}/node" "#{libexec}/bin/opencode-variants" "$@"
    EOS
    chmod 0755, bin/"ov"
    (bin/"opencode-variants").write <<~EOS
      #!/bin/bash
      exec "#{Formula["node"].opt_bin}/node" "#{libexec}/bin/opencode-variants" "$@"
    EOS
    chmod 0755, bin/"opencode-variants"
  end

  def caveats
    <<~EOS
      direnv must be active in your shell to pick up generated .envrc files.
      Add to ~/.zshrc if not already present:
        eval "$(direnv hook zsh)"
    EOS
  end

  test do
    ENV["OV_HOME"] = testpath/"state"
    assert_match "model-reasoning", shell_output("#{bin}/ov models")
    assert_match(/no provider|catalog empty/, shell_output("#{bin}/ov cost nope 2>&1", 1))
    assert_match "unknown variant", shell_output("#{bin}/ov serve nope 2>&1", 1)
  end
end
