package parser

import (
	"errors"
	"strings"

	"github.com/usememos/memos/plugin/gomark/ast"
	"github.com/usememos/memos/plugin/gomark/parser/tokenizer"
)

type HTMLBlockParser struct{}

func NewHTMLBlockParser() *HTMLBlockParser {
	return &HTMLBlockParser{}
}

func (*HTMLBlockParser) Match(tokens []*tokenizer.Token) (int, bool) {
	if len(tokens) < 3 {
		return 0, false
	}
	if tokens[0].Type != tokenizer.LessThan {
		return 0, false
	}

	// Find the end of the opening tag.
	openTagEnd := -1
	for i := 1; i < len(tokens); i++ {
		if tokens[i].Type == tokenizer.GreaterThan {
			openTagEnd = i
			break
		}
	}
	if openTagEnd == -1 {
		return 0, false
	}

	openTagStr := strings.ToLower(tokenizer.Stringify(tokens[:openTagEnd+1]))
	if !strings.HasPrefix(openTagStr, "<blockquote") {
		return 0, false
	}
	// Verify that tag name is strictly blockquote (e.g. not <blockquotexyz>).
	if len(openTagStr) > len("<blockquote") {
		nextChar := openTagStr[len("<blockquote")]
		if nextChar != ' ' && nextChar != '>' && nextChar != '/' && nextChar != '\n' && nextChar != '\t' {
			return 0, false
		}
	}

	// Find the closing </blockquote> tag.
	closeTagEnd := -1
	for i := openTagEnd + 1; i < len(tokens); i++ {
		if tokens[i].Type == tokenizer.LessThan {
			for j := i + 1; j < len(tokens); j++ {
				if tokens[j].Type == tokenizer.GreaterThan {
					tagContent := strings.ToLower(strings.TrimSpace(tokenizer.Stringify(tokens[i+1 : j])))
					if tagContent == "/blockquote" {
						closeTagEnd = j
						break
					}
					break
				}
			}
			if closeTagEnd != -1 {
				break
			}
		}
	}
	if closeTagEnd == -1 {
		return 0, false
	}

	matchedSize := closeTagEnd + 1

	// Check if an optional <script> tag immediately follows (with optional spaces/newlines).
	cursor := matchedSize
	for cursor < len(tokens) && (tokens[cursor].Type == tokenizer.Space || tokens[cursor].Type == tokenizer.Newline) {
		cursor++
	}

	if cursor < len(tokens) && tokens[cursor].Type == tokenizer.LessThan {
		scriptOpenEnd := -1
		for i := cursor + 1; i < len(tokens); i++ {
			if tokens[i].Type == tokenizer.GreaterThan {
				scriptOpenEnd = i
				break
			}
		}
		if scriptOpenEnd != -1 {
			scriptOpenStr := strings.ToLower(tokenizer.Stringify(tokens[cursor : scriptOpenEnd+1]))
			if strings.HasPrefix(scriptOpenStr, "<script") {
				// Look for closing </script> tag
				scriptCloseEnd := -1
				for i := scriptOpenEnd + 1; i < len(tokens); i++ {
					if tokens[i].Type == tokenizer.LessThan {
						for j := i + 1; j < len(tokens); j++ {
							if tokens[j].Type == tokenizer.GreaterThan {
								tagContent := strings.ToLower(strings.TrimSpace(tokenizer.Stringify(tokens[i+1 : j])))
								if tagContent == "/script" {
									scriptCloseEnd = j
									break
								}
								break
							}
						}
						if scriptCloseEnd != -1 {
							break
						}
					}
				}
				if scriptCloseEnd != -1 {
					matchedSize = scriptCloseEnd + 1
				}
			}
		}
	}

	return matchedSize, true
}

func (p *HTMLBlockParser) Parse(tokens []*tokenizer.Token) (ast.Node, error) {
	size, ok := p.Match(tokens)
	if size == 0 || !ok {
		return nil, errors.New("not matched")
	}

	return &ast.Paragraph{
		Children: []ast.Node{
			&ast.Text{
				Content: tokenizer.Stringify(tokens[:size]),
			},
		},
	}, nil
}
