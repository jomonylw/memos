package parser

import (
	"testing"

	"github.com/stretchr/testify/require"

	"github.com/usememos/memos/plugin/gomark/ast"
	"github.com/usememos/memos/plugin/gomark/parser/tokenizer"
	"github.com/usememos/memos/plugin/gomark/restore"
)

func TestHTMLBlockParser(t *testing.T) {
	tests := []struct {
		text      string
		expected  ast.Node
		shouldErr bool
	}{
		{
			text: `<blockquote class="twitter-tweet">
<p lang="en" dir="ltr">Hello world</p>
&mdash; User (@user) <a href="https://twitter.com/user/status/1234567890">March 1, 2024</a>
</blockquote>
<script async src="https://platform.twitter.com/widgets.js" charset="utf-8"></script>`,
			expected: &ast.Paragraph{
				Children: []ast.Node{
					&ast.Text{
						Content: `<blockquote class="twitter-tweet">
<p lang="en" dir="ltr">Hello world</p>
&mdash; User (@user) <a href="https://twitter.com/user/status/1234567890">March 1, 2024</a>
</blockquote>
<script async src="https://platform.twitter.com/widgets.js" charset="utf-8"></script>`,
					},
				},
			},
			shouldErr: false,
		},
		{
			text: `<blockquote class="twitter-tweet"><p>Hello</p></blockquote>`,
			expected: &ast.Paragraph{
				Children: []ast.Node{
					&ast.Text{
						Content: `<blockquote class="twitter-tweet"><p>Hello</p></blockquote>`,
					},
				},
			},
			shouldErr: false,
		},
		{
			text:      `<a href="https://example.com">Link</a>`,
			expected:  nil,
			shouldErr: true,
		},
	}

	for _, test := range tests {
		tokens := tokenizer.Tokenize(test.text)
		node, err := NewHTMLBlockParser().Parse(tokens)
		if test.shouldErr {
			require.Error(t, err)
		} else {
			require.NoError(t, err)
			require.Equal(t, restore.Restore([]ast.Node{test.expected}), restore.Restore([]ast.Node{node}))
		}
	}
}

func TestHTMLBlockInParseBlock(t *testing.T) {
	text := `<blockquote class="twitter-tweet">
<p>Post</p>
</blockquote>
<script async src="https://platform.twitter.com/widgets.js"></script>

Another paragraph`

	tokens := tokenizer.Tokenize(text)
	nodes, err := ParseBlock(tokens)
	require.NoError(t, err)
	// Should produce 3 nodes: HTML block (Paragraph), LineBreak (empty line), Paragraph
	require.True(t, len(nodes) >= 2)
	require.Equal(t, ast.ParagraphNode, nodes[0].Type())
	require.Contains(t, nodes[0].Restore(), "twitter-tweet")
	require.Contains(t, nodes[0].Restore(), "widgets.js")
	lastNode := nodes[len(nodes)-1]
	require.Equal(t, ast.ParagraphNode, lastNode.Type())
	require.Equal(t, "Another paragraph", lastNode.Restore())
}
