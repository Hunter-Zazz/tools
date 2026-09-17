"use strict";

function flowStep(kind, label, amount, primary, secondary = "") {
  const row = document.createElement("article");
  row.className = `flow-row ${kind}`;

  const marker = document.createElement("span");
  marker.className = "flow-marker";
  marker.textContent = label;

  const value = document.createElement("strong");
  value.className = "flow-value";
  value.textContent = amount;

  const body = document.createElement("div");
  body.className = "flow-body";

  const main = document.createElement("span");
  main.className = "flow-main";
  main.textContent = primary;
  body.append(main);

  if (secondary) {
    const meta = document.createElement("small");
    meta.className = "flow-meta";
    meta.textContent = secondary;
    body.append(meta);
  }

  row.append(marker, value, body);
  return row;
}

function flowArrow(label = "") {
  const arrow = document.createElement("div");
  arrow.className = "flow-arrow";
  arrow.textContent = "↓";

  if (label) {
    const text = document.createElement("small");
    text.textContent = label;
    arrow.append(text);
  }

  return arrow;
}

function transactionTotal(node) {
  if (!node.outputs) return 0;
  return node.outputs.reduce((sum, output) => sum + Number(output.value || 0), 0);
}

function renderFlowTransaction(node, isRoot = false) {
  const fragment = document.createDocumentFragment();

  if (node.repeated) {
    fragment.append(
      flowStep("stop", "SEEN", "", short(node.txid), "Duplicate path suppressed"),
    );
    return fragment;
  }

  if (node.pending) {
    fragment.append(
      flowStep("pending", "MORE", "", short(node.txid), "Waiting for Expand search"),
    );
    return fragment;
  }

  if (node.depthLimited) {
    fragment.append(
      flowStep("stop", "LIMIT", "", short(node.txid), "Maximum trace depth reached"),
    );
    return fragment;
  }

  if (node.frontierLimited) {
    fragment.append(
      flowStep("stop", "LIMIT", "", short(node.txid), "Trace frontier safety limit reached"),
    );
    return fragment;
  }

  const chainMeta = `${node.confirmed ? `Block ${node.blockHeight}` : "Unconfirmed"} · ${when(node.blockTime)}`;
  fragment.append(
    flowStep(
      isRoot ? "start" : "transaction",
      isRoot ? "START" : `TX ${node.depth}`,
      btc(transactionTotal(node)),
      short(node.txid),
      chainMeta,
    ),
  );

  if (!node.outputs.length) return fragment;

  if (node.outputs.length > 1) {
    fragment.append(flowArrow(`split into ${node.outputs.length} outputs`));
  } else {
    fragment.append(flowArrow());
  }

  const branches = document.createElement("div");
  branches.className = node.outputs.length > 1 ? "flow-branches split" : "flow-branches";

  node.outputs.forEach((output, index) => {
    const branch = document.createElement("section");
    branch.className = "flow-branch";

    if (node.outputs.length > 1) {
      const branchLabel = document.createElement("span");
      branchLabel.className = "branch-label";
      branchLabel.textContent = `BRANCH ${index + 1}`;
      branch.append(branchLabel);
    }

    const destination = output.address ||
      (output.scriptType ? output.scriptType.toUpperCase() : "non-address/script output");

    branch.append(
      flowStep(
        output.spent ? "sent" : "unspent",
        output.spent ? "SENT" : "UNSPENT",
        btc(output.value),
        destination,
        `vout ${output.index}${output.spentVin !== null ? ` · later spent as vin ${output.spentVin}` : ""}`,
      ),
    );

    if (output.child) {
      branch.append(flowArrow(output.child.pending ? "more path available" : "then"));
      branch.append(renderFlowTransaction(output.child, false));
    } else if (!output.spent) {
      branch.append(
        flowStep(
          "current",
          "END",
          btc(output.value),
          destination,
          "No later spending transaction is currently recorded",
        ),
      );
    }

    branches.append(branch);
  });

  fragment.append(branches);
  return fragment;
}

window.txNode = function poseidonFlowNode(node, root = false) {
  return renderFlowTransaction(node, root);
};
