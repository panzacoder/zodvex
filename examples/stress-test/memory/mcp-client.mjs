import { spawn } from "node:child_process";
import { createInterface } from "node:readline";
import { fileURLToPath } from "node:url";
export async function connect(deployment) {
	const root = fileURLToPath(new URL("..", import.meta.url));
	if (!deployment || !/^[a-z]+-[a-z]+-\d+$/.test(deployment))
		throw new Error("Explicit dedicated deployment name required");
	for (const key of [
		"CONVEX_DEPLOY_KEY",
		"CONVEX_SELF_HOSTED_URL",
		"CONVEX_SELF_HOSTED_ADMIN_KEY",
	])
		if (process.env[key]) throw new Error("Unexpected target override");
	const child = spawn(
		"node",
		[
			root + "/node_modules/convex/dist/cli.bundle.cjs",
			"mcp",
			"start",
			"--project-dir",
			root + "/_deploy",
			"--deployment-name",
			deployment,
			"--disable-tools",
			"data,envGet,envList,envRemove,envSet,functionSpec,insights,logs,run,tables",
		],
		{ cwd: root + "/_deploy", stdio: ["pipe", "pipe", "pipe"] },
	);
	const close = () => child.kill();
	let nextId = 1;
	const pending = new Map();
	let stderr = "";
	child.stderr.on("data", (data) => {
		stderr = (stderr + data.toString()).slice(-2000);
	});
	createInterface({ input: child.stdout }).on("line", (line) => {
		try {
			const result = JSON.parse(line);
			if (pending.has(result.id)) {
				const entry = pending.get(result.id);
				clearTimeout(entry.timer);
				pending.delete(result.id);
				result.error
					? entry.reject(new Error(JSON.stringify(result.error)))
					: entry.resolve(result.result);
			}
		} catch {}
	});
	child.on("error", (error) => {
		for (const entry of pending.values()) {
			clearTimeout(entry.timer);
			entry.reject(error);
		}
		pending.clear();
		close();
	});
	child.on("exit", () => {
		for (const entry of pending.values()) {
			clearTimeout(entry.timer);
			entry.reject(new Error("CLI MCP exited " + stderr.slice(-500)));
		}
		pending.clear();
		close();
	});
	function request(method, params) {
		return new Promise((resolve, reject) => {
			const id = nextId++;
			const timer = setTimeout(() => {
				pending.delete(id);
				reject(new Error("CLI MCP request timeout"));
				close();
			}, 30000);
			pending.set(id, { resolve, reject, timer });
			child.stdin.write(
				JSON.stringify({ jsonrpc: "2.0", id, method, params }) + "\n",
			);
		});
	}
	try {
		await request("initialize", {
			protocolVersion: "2024-11-05",
			capabilities: {},
			clientInfo: { name: "zodvex-graph-benchmark", version: "0.1" },
		});
		child.stdin.write(
			JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" }) +
				"\n",
		);
		const status = await request("tools/call", {
			name: "status",
			arguments: { projectDir: root + "/_deploy" },
		});
		if (status.isError)
			throw new Error(
				"Convex target lookup failed; check CLI login and _deploy project configuration",
			);
		const inventory = JSON.parse(
			status.content.find((c) => c.type === "text").text,
		);
		if (!Array.isArray(inventory.availableDeployments))
			throw new Error("Convex target lookup returned no deployment inventory");
		const target = inventory.availableDeployments.find(
			(d) => d.url === `https://${deployment}.convex.cloud` && !d.readOnly,
		);
		if (!target) {
			close();
			throw new Error("Expected dedicated dev target not present");
		}
		return {
			target: target.url,
			run: async (query) =>
				request("tools/call", {
					name: "runOneoffQuery",
					arguments: { deploymentSelector: target.deploymentSelector, query },
				}),
			close,
		};
	} catch (error) {
		close();
		throw error;
	}
}
