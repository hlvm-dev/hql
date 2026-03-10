import { log } from "../../api/log.ts";
import { truncate } from "../../../common/utils.ts";

export type RegistryType = "npm" | "jsr";

export interface PublishSummary {
  registry: RegistryType;
  name: string;
  version: string;
  link: string;
}

export function printPublishSummary(summaries: PublishSummary[]) {
  const REGISTRY_WIDTH = 10;
  const NAME_WIDTH = 30;
  const VERSION_WIDTH = 9;
  const LINK_WIDTH = 60;
  const STATUS_WIDTH = 8;

  const colWidths = [
    REGISTRY_WIDTH,
    NAME_WIDTH,
    VERSION_WIDTH,
    STATUS_WIDTH,
    LINK_WIDTH,
  ];

  function padCell(content: string, width: number): string {
    return " " + content.padEnd(width - 2) + " ";
  }

  const top = "╔" + colWidths.map((w) => "═".repeat(w)).join("╦") + "╗";
  const sep = "╠" + colWidths.map((w) => "═".repeat(w)).join("╬") + "╣";
  const bottom = "╚" + colWidths.map((w) => "═".repeat(w)).join("╩") + "╝";

  function row(cells: string[]): string {
    return "║" + cells.map((c, i) => {
      const content = truncate(c, colWidths[i] - 2);
      return padCell(content, colWidths[i]);
    }).join("║") + "║";
  }

  const tableWidth = colWidths.reduce((a, b) => a + b, 0) + colWidths.length +
    1;
  const title = "📦 Publish Summary";
  const pad = Math.max(0, Math.floor((tableWidth - title.length) / 2));
  const centeredTitle = " ".repeat(pad) + title + " ".repeat(pad);

  log.raw.log("\n" + centeredTitle + "\n");
  log.raw.log(top);
  log.raw.log(row(["Registry", "Name", "Version", "Status", "Link/Error"]));
  log.raw.log(sep);

  for (const s of summaries) {
    const status = s.link.startsWith("❌") ? "❌" : "✅";
    const link = s.link.startsWith("❌") ? s.link.substring(2).trim() : s.link;

    log.raw.log(row([
      s.registry.toUpperCase(),
      s.name,
      s.version,
      status,
      truncate(link, LINK_WIDTH - 5),
    ]));
  }

  log.raw.log(bottom + "\n");

  for (const s of summaries) {
    if (s.link.startsWith("❌")) {
      log.raw.log(`❌ ${s.registry.toUpperCase()}: ${s.link.substring(2)}`);
    } else {
      log.raw.log(`✅ ${s.registry.toUpperCase()}: ${s.link}`);
    }
  }

  const successCount = summaries.filter((s) => !s.link.startsWith("❌")).length;
  const failCount = summaries.length - successCount;

  if (successCount > 0 && failCount === 0) {
    log.raw.log(`\n✅ All publishing operations completed successfully!`);
  } else if (successCount > 0 && failCount > 0) {
    log.raw.log(
      `\n⚠️ ${successCount} operation(s) succeeded, ${failCount} operation(s) failed.`,
    );
  } else if (successCount === 0 && failCount > 0) {
    log.raw.log(`\n❌ All publishing operations failed.`);
  }
}
