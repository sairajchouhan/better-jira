const isTestFile = (filename) => /\.(test|e2e|real)\.[cm]?[jt]sx?$/.test(filename);
const isSrcFile = (filename) => filename.includes("/src/") || filename.startsWith("src/");
const isWriteTransportFile = (filename) => filename.endsWith("/src/shared/write-transport.ts") || filename === "src/shared/write-transport.ts";

const HARDCODED_JIRA_TYPES = new Set(["Subtask", "Sub-task", "subtask", "sub-task", "Epic"]);
const TYPE_IDENTIFIERS = new Set(["type", "issueType", "issuetype", "parentType", "name"]);

function isTypeExpr(node) {
  if (!node) return false;
  if (node.type === "Identifier") return TYPE_IDENTIFIERS.has(node.name);
  if (node.type === "MemberExpression" && !node.computed && node.property?.type === "Identifier") {
    return TYPE_IDENTIFIERS.has(node.property.name);
  }
  if (node.type === "ChainExpression") return isTypeExpr(node.expression);
  return false;
}

function stringLiteralValue(node) {
  if (!node) return null;
  if (node.type === "Literal" && typeof node.value === "string") return node.value;
  if (node.type === "TemplateLiteral" && node.expressions.length === 0) {
    return node.quasis[0]?.value?.cooked ?? null;
  }
  return null;
}

function urlTextOf(node) {
  if (!node) return "";
  if (node.type === "Literal" && typeof node.value === "string") return node.value;
  if (node.type === "TemplateLiteral") {
    return node.quasis.map((q) => q.value.cooked ?? q.value.raw ?? "").join("${}");
  }
  return "";
}

function isPostMethod(initNode) {
  if (!initNode || initNode.type !== "ObjectExpression") return false;
  for (const prop of initNode.properties) {
    if (prop.type !== "Property") continue;
    const key = prop.key.type === "Identifier" ? prop.key.name : prop.key.value;
    if (key === "method") {
      const val = stringLiteralValue(prop.value);
      return val?.toUpperCase() === "POST";
    }
  }
  return false;
}

export default {
  meta: { name: "better-jira" },
  rules: {
    "no-hardcoded-jira-type-name": {
      create(context) {
        if (isTestFile(context.filename) || !isSrcFile(context.filename)) return {};
        return {
          BinaryExpression(node) {
            if (!["===", "!==", "==", "!="].includes(node.operator)) return;
            const leftStr = stringLiteralValue(node.left);
            const rightStr = stringLiteralValue(node.right);
            if (rightStr && HARDCODED_JIRA_TYPES.has(rightStr) && isTypeExpr(node.left)) {
              context.report({
                node,
                message: `Do not compare Jira issue types by string name ("${rightStr}"). Check Jira's subtask flag or hierarchyLevel (see src/shared/issue-properties.ts and src/shared/epics.ts).`,
              });
            } else if (leftStr && HARDCODED_JIRA_TYPES.has(leftStr) && isTypeExpr(node.right)) {
              context.report({
                node,
                message: `Do not compare Jira issue types by string name ("${leftStr}"). Check Jira's subtask flag or hierarchyLevel (see src/shared/issue-properties.ts and src/shared/epics.ts).`,
              });
            }
          },
        };
      },
    },
    "no-raw-popover-on-open-change": {
      create(context) {
        if (isTestFile(context.filename) || !isSrcFile(context.filename)) return {};
        return {
          JSXOpeningElement(node) {
            if (node.name?.type !== "JSXIdentifier" || node.name.name !== "AriaPopover") return;
            const hasIsNonModal = node.attributes.some(
              (attr) => attr.type === "JSXAttribute" && attr.name?.name === "isNonModal",
            );
            if (!hasIsNonModal) return;
            for (const attr of node.attributes) {
              if (attr.type !== "JSXAttribute" || attr.name?.name !== "onOpenChange") continue;
              const expr = attr.value?.type === "JSXExpressionContainer" ? attr.value.expression : null;
              if (expr && (expr.type === "ArrowFunctionExpression" || expr.type === "FunctionExpression")) {
                context.report({
                  node: attr,
                  message:
                    "Do not pass a raw inline onOpenChange handler to a releasing AriaPopover. Pass useRelease's onOpenChange(close) in src/client/components/menu-surface.tsx so a menu row opening a dialog is not closed by React Aria's focus return.",
                });
              }
            }
          },
        };
      },
    },
    "no-raw-write-fetch": {
      create(context) {
        if (isTestFile(context.filename) || !isSrcFile(context.filename) || isWriteTransportFile(context.filename)) return {};
        return {
          CallExpression(node) {
            if (node.callee?.type !== "Identifier" || node.callee.name !== "fetch") return;
            const url = urlTextOf(node.arguments[0]);
            const init = node.arguments[1];
            const isOps = url.includes("/api/issues/") && url.endsWith("/ops");
            const isUpload = url.includes("/api/issues/") && url.endsWith("/attachments") && isPostMethod(init);
            const isInboxWrite = url === "/api/inbox" && isPostMethod(init);
            if (isOps || isUpload || isInboxWrite) {
              context.report({
                node,
                message:
                  "Do not call fetch() directly for Jira or inbox writes. Use sendWriteRequest() or fetchWriteEndpoint() from src/shared/write-transport.ts so Unreachable and 503 NoAnswer responses are retried instead of rolled back as refused.",
              });
            }
          },
        };
      },
    },
    "no-prod-as-any": {
      create(context) {
        if (isTestFile(context.filename)) return {};
        if (!context.filename.includes("/src/") && !context.filename.startsWith("src/")) return {};
        return {
          TSAsExpression(node) {
            if (node.typeAnnotation?.type === "TSAnyKeyword") {
              context.report({
                node,
                message:
                  "Do not use 'as any' in production code. Use typed field helpers (getIssueField/copyIssueField/pickIssueFields in src/shared/issue-model.ts) or define a typed boundary interface.",
              });
            }
          },
        };
      },
    },
  },
};
