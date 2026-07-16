// Demo das features do fork (branch feature/tasks-multi-repo-pr-analyzer).
// Uso: node demo-features.mjs   (daemon dev precisa estar de pé na 6768)
import { WebSocket } from "ws";

const DAEMON = "ws://127.0.0.1:6768/ws";
const REPO_CWD = process.cwd();

const ws = new WebSocket(DAEMON);
const pending = new Map();
let features = null;
let started = false;

function request(message) {
  return new Promise((resolve, reject) => {
    pending.set(message.requestId, resolve);
    setTimeout(() => reject(new Error(`timeout esperando ${message.type}`)), 30000);
    ws.send(JSON.stringify({ type: "session", message }));
  });
}

ws.on("open", () => {
  ws.send(
    JSON.stringify({
      type: "hello",
      clientId: "demo-features",
      clientType: "cli",
      protocolVersion: 1,
    }),
  );
});

ws.on("message", async (data) => {
  const parsed = JSON.parse(data.toString());
  if (parsed.type !== "session") return;
  const msg = parsed.message;
  if (!started && msg.type === "status" && msg.payload?.status === "server_info") {
    started = true;
    features = msg.payload.features;
    try {
      await main();
      process.exit(0);
    } catch (error) {
      console.error("\nFALHOU:", error.message);
      process.exit(1);
    }
  }
  const requestId = msg.payload?.requestId;
  if (requestId && pending.has(requestId)) {
    pending.get(requestId)(msg);
    pending.delete(requestId);
  }
});

async function main() {
  console.log("=== Capability flags do daemon ===");
  console.log("  tasksCore:", features?.tasksCore);
  console.log("  tasksOrigins:", features?.tasksOrigins);
  console.log("  checkoutGithubPrReview:", features?.checkoutGithubPrReview);

  console.log("\n=== 1) Task vinculada a VÁRIOS repos + origem ===");
  const created = await request({
    type: "tasks.core.create.request",
    title: "Demo: task multi-repo com origem Jira",
    repos: ["hugolrf/paseo", "hugolrf/Pane"],
    agentIds: [],
    origin: "jira:APLIC-806",
    requestId: "d-1",
  });
  const task = created.payload.task;
  console.log(`  criada ${task.id}: "${task.title}"`);
  console.log(`  repos: ${JSON.stringify(task.repos)} | origin: ${task.origin}`);

  const filtered = await request({
    type: "tasks.core.list.request",
    repo: "hugolrf/Pane",
    requestId: "d-2",
  });
  console.log(
    `  filtro por repo "hugolrf/Pane" retornou: ${filtered.payload.tasks.map((t) => t.id).join(", ")}`,
  );

  console.log("\n=== 2) Status REAL das origens (tasks.origins.get_issue) ===");
  for (const ref of ["jira:APLIC-806", "azure:15640", "linear:HUG-1800"]) {
    const res = await request({
      type: "tasks.origins.get_issue.request",
      ref,
      requestId: `d-o-${ref}`,
    });
    const { issue, error } = res.payload;
    if (error) console.log(`  ${ref} -> ERRO: ${error}`);
    else console.log(`  ${ref} -> [${issue.status}] "${issue.title.slice(0, 70)}"`);
  }

  console.log("\n=== 3) PRs da origem (checkout.github.*) ===");
  const prs = await request({
    type: "checkout.github.list_pull_requests.request",
    cwd: REPO_CWD,
    limit: 3,
    requestId: "d-3",
  });
  if (prs.payload.error) {
    console.log("  ERRO:", JSON.stringify(prs.payload.error));
  } else {
    for (const pr of prs.payload.pullRequests) {
      console.log(`  #${pr.number} [${pr.state}] ${pr.title}`);
    }
    const first = prs.payload.pullRequests[0];
    if (first) {
      const diff = await request({
        type: "checkout.github.get_pr_diff.request",
        cwd: REPO_CWD,
        prNumber: first.number,
        requestId: "d-4",
      });
      const size = diff.payload.diff?.length ?? 0;
      console.log(
        `  diff do PR #${first.number}: ${size} chars${diff.payload.truncated ? " (truncado em 256KiB)" : ""}`,
      );
      console.log(
        `  (pra solicitar ajustes: RPC checkout.github.review_pr com event="request_changes" — não disparado na demo)`,
      );
    }
  }

  await request({ type: "tasks.core.delete.request", id: task.id, requestId: "d-5" });
  console.log("\nDemo concluída (task de demo removida).");
}
