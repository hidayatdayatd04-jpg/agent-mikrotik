interface MarkdownNode { type: string; value?: string; children?: MarkdownNode[] }

/** Remove decorative emoji from prose, keeping source code and user data intact. */
export function remarkCleanResponse() {
  return (tree: MarkdownNode) => {
    function visit(node: MarkdownNode) {
      if (node.type === "code" || node.type === "inlineCode") return;
      if (node.type === "text" && node.value) {
        node.value = node.value.replace(/[\p{Extended_Pictographic}\p{Emoji_Presentation}\u200d\ufe0f\u20e3]/gu, "");
      }
      node.children?.forEach(visit);
    }
    visit(tree);
  };
}
