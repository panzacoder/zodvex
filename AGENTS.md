# Agent guidance

Read [CLAUDE.md](CLAUDE.md) for the project's architecture, commands, testing conventions, and development guidance. It applies to all agents working in this repository.

Matt Pocock's complete skill collection is installed in [.agents/skills](.agents/skills). See the [catalog](.agents/skills/README.md) for available skills and their upstream source. Before using a skill, read `.agents/skills/<name>/SKILL.md` and any supporting files it references. Respect its invocation rules and adapt its tool instructions to the current agent's capabilities.

The `.claude/skills`, `.cursor/skills`, and `.github/skills` directories link to the same collection. Agents without native skill discovery can read the canonical files directly.
