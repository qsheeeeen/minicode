# 已完成 ✅
- [x] config 控制一个 provider 多个 model（model@provider 格式）
- [x] config 挪到 ~/.minicode/
- [x] 全局提示词（~/.minicode/MINICODE.md）
- [x] 项目提示词（项目根目录 MINICODE.md）
- [x] 提示词加载机制（src/utils/prompts.ts）

# 待办事项 📋

## 功能增强
- [ ] 中文提示词支持（系统提示词国际化）
- [ ] 命令行工具控制（如 `/enable tool`、`/disable tool`）
- [ ] tool 递归调用（让 agent 能够调用自身作为工具）
- [ ] Security Hook（自动检查危险操作，如 rm -rf、文件覆盖等）

## 代码质量
- [ ] 添加单元测试框架
- [ ] 添加 ESLint/Prettier 配置
- [ ] 类型检查严格模式

## 文档
- [ ] 完善使用文档
- [ ] 添加工具开发指南
- [ ] 编写自举开发日志

## 实验性功能
- [ ] Skill 系统？（可复用的代码模式/技能包）
- [ ] 多模型并行调用（同时使用多个模型投票或分工）
- [ ] Web 搜索工具集成
- [ ] 代码执行沙箱

# Bug 追踪
- 暂无

# 想法 💡
- 添加 `/diff` 命令查看对话变更历史
- 支持会话导出为 Markdown
- 添加 `/teach` 模式，让用户教 agent 新技能
- 实现会话分支（类似 git branch）
