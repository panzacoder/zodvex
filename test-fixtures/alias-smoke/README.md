Fixture for #99: a Convex project whose modules import through a tsconfig
path alias (`@/convex/...`). `zodvex generate` must resolve the alias when
running under Node (Bun resolves tsconfig paths natively). Exercised by the
CI "CLI smoke test under Node" step.
