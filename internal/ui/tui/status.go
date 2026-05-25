package tui

import (
	"fmt"
	"strconv"
)

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

func (m *TUIModel) renderStatusBar() string {
	provider := m.agent.Provider()
	if provider == "" {
		provider = "unknown"
	}
	line1 := styleGreen.Render(provider) + styleDim.Render(":") + m.modelName + styleDim.Render(" | "+m.session)
	if m.err != nil {
		line1 += styleDim.Render(" | ") + styleErrorMsg.Render("ERR: "+m.err.Error())
	} else if m.streaming {
		line1 += styleDim.Render(" | ") + styleMagenta.Render("streaming")
	}

	ctxLen := m.agent.ContextLength()
	if ctxLen == 0 {
		ctxLen = 200000
	}
	pct := float64(m.tokenCount) / float64(ctxLen) * 100
	if pct > 100 {
		pct = 100
	}

	permMode := "manual"
	if p := m.agent.PermissionSvc(); p != nil {
		permMode = string(p.Mode())
	}

	modeColor := styleYellow
	if permMode == "yolo" {
		modeColor = styleRed
	} else if permMode == "auto" {
		modeColor = styleHeaderCyan
	}

	line2 := styleDim.Render(fmt.Sprintf("%s/%s ", formatNumber(m.tokenCount), formatNumber(ctxLen))) +
		m.prog.ViewAs(pct/100) +
		styleDim.Render(fmt.Sprintf(" %d%% │ ", int(pct))) +
		modeColor.Render(permMode) +
		styleDim.Render(" (Shift+Tab)")

	return line1 + "\n" + line2
}
