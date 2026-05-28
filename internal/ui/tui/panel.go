package tui

import (
	"fmt"
	"strconv"

	"github.com/charmbracelet/bubbles/progress"
	"minicode/internal/agent"
)

// PanelModel holds the state for the bottom panel.
type PanelModel struct {
	prog       progress.Model
	tokenCount int
	modelName  string
	session    string
	err        error
	streaming  bool
}

func formatNumber(n int) string {
	in := strconv.Itoa(n)
	var out []byte
	for i := 0; i < len(in); i++ {
		if i > 0 && (len(in)-i)%3 == 0 {
			out = append(out, ',')
		}
		out = append(out, in[i])
	}
	return string(out)
}

// View renders the panel.
func (p *PanelModel) View(ag *agent.Agent) string {
	provider := ag.Provider()
	if provider == "" {
		provider = "unknown"
	}
	line1 := styleGreen.Render(provider) + styleDim.Render(":") + p.modelName + styleDim.Render(" | "+p.session)
	if p.err != nil {
		line1 += styleDim.Render(" | ") + styleErrorMsg.Render("ERR: "+p.err.Error())
	} else if p.streaming {
		line1 += styleDim.Render(" | ") + styleMagenta.Render("streaming")
	}

	ctxLen := ag.ContextLength()
	if ctxLen == 0 {
		ctxLen = 200000
	}
	pct := float64(p.tokenCount) / float64(ctxLen) * 100
	if pct > 100 {
		pct = 100
	}

	permMode := "manual"
	if p := ag.PermissionSvc(); p != nil {
		permMode = string(p.Mode())
	}

	modeColor := styleYellow
	if permMode == "yolo" {
		modeColor = styleRed
	} else if permMode == "auto" {
		modeColor = styleHeaderCyan
	}

	line2 := styleDim.Render(fmt.Sprintf("%s/%s ", formatNumber(p.tokenCount), formatNumber(ctxLen))) +
		p.prog.ViewAs(pct/100) +
		styleDim.Render(fmt.Sprintf(" %d%% │ ", int(pct))) +
		modeColor.Render(permMode)

	return line1 + "\n" + line2
}
