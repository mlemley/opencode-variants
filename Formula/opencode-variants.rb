class OpencodeVariants < Formula
  desc "Per-directory OpenCode model routing via generated direnv configs"
  homepage "https://github.com/mlemley/opencode-variants"
  url "https://github.com/mlemley/opencode-variants/archive/refs/tags/v0.2.0.tar.gz"
  sha256 "db04a8ef07043724b3d0f56037c51b2a79a74a144cc391a9ad04a3092afc2e07"

  depends_on "direnv"
  depends_on "node"

  def install
    libexec.install Dir["*"]
    (bin/"ov").write <<~EOS
      #!/bin/bash
      exec "#{formula_opt_bin("node")}/node" "#{libexec}/bin/opencode-variants" "$@"
    EOS
    chmod 0755, bin/"ov"
    (bin/"opencode-variants").write <<~EOS
      #!/bin/bash
      exec "#{formula_opt_bin("node")}/node" "#{libexec}/bin/opencode-variants" "$@"
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
