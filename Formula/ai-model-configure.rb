# TODO before publishing: replace url/homepage with the real release archive once
# the repo lands on GitHub/GitLab. Local testing uses the file:// tarball built by:
#   git archive --format=tar.gz --prefix=ai-model-configure-<version>/ \
#     -o /tmp/ai-model-configure-<version>.tar.gz HEAD
class AiModelConfigure < Formula
  desc "Per-directory OpenCode model routing (cloud/hybrid/all-local) via generated direnv configs"
  version "0.2.0"
  homepage "https://example.invalid/ai-model-configure" # TODO real homepage
  url "file:///tmp/ai-model-configure-0.2.0.tar.gz"
  sha256 "8e125bac06768f52cbd2ab0f6b1719522b16f12bfda27b7696d91af2ad689a12"

  depends_on "direnv"
  depends_on "node"

  def install
    libexec.install Dir["*"]
    (bin/"ai-model-configure").write <<~EOS
      #!/bin/bash
      exec "#{Formula["node"].opt_bin}/node" "#{libexec}/bin/ai-model-configure" "$@"
    EOS
    chmod 0755, bin/"ai-model-configure"
    (bin/"ai-cost").write <<~EOS
      #!/bin/bash
      exec "#{Formula["node"].opt_bin}/node" "#{libexec}/bin/ai-cost" "$@"
    EOS
    chmod 0755, bin/"ai-cost"
    (bin/"ai").write <<~EOS
      #!/bin/bash
      exec "#{Formula["node"].opt_bin}/node" "#{libexec}/bin/ai" "$@"
    EOS
    chmod 0755, bin/"ai"
  end

  def caveats
    <<~EOS
      direnv must be active in your shell to pick up generated .envrc files.
      Add to ~/.zshrc if not already present:
        eval "$(direnv hook zsh)"
    EOS
  end

  test do
    ENV["AMC_HOME"] = testpath/"state"
    assert_match "model-reasoning", shell_output("#{bin}/ai-model-configure models")
    assert_match(/no provider|catalog empty/, shell_output("#{bin}/ai-cost nope 2>&1", 1))
    assert_match "unknown variant", shell_output("#{bin}/ai nope 2>&1", 1)
  end
end
