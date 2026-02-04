/**
 * Data Tools Tests
 *
 * Verifies generic aggregation/filtering/transformation tools.
 */

import { assertEquals } from "jsr:@std/assert";
import {
  aggregateEntries,
  filterEntries,
  transformEntries,
  compute,
  type AggregateEntriesArgs,
  type FilterEntriesArgs,
  type TransformEntriesArgs,
  type ComputeArgs,
} from "../../../src/hlvm/agent/tools/data-tools.ts";

const TEST_WORKSPACE = "/tmp/hlvm-data-tools";

Deno.test({
  name: "Data Tools: aggregate_entries - sum by field",
  async fn() {
    const result = await aggregateEntries(
      {
        items: [{ size: 4 }, { size: 6 }, { size: 10 }],
        operation: "sum",
        field: "size",
      } as AggregateEntriesArgs,
      TEST_WORKSPACE,
    );

    assertEquals(result.success, true);
    assertEquals(result.value, 20);
    assertEquals(result.itemsCount, 3);
    assertEquals(result.valueCount, 3);
  },
});

Deno.test({
  name: "Data Tools: aggregate_entries - count",
  async fn() {
    const result = await aggregateEntries(
      { items: [1, 2, 3], operation: "count" } as AggregateEntriesArgs,
      TEST_WORKSPACE,
    );

    assertEquals(result.success, true);
    assertEquals(result.value, 3);
  },
});

Deno.test({
  name: "Data Tools: filter_entries - equals",
  async fn() {
    const result = await filterEntries(
      {
        items: [
          { type: "video", name: "a.mov" },
          { type: "image", name: "b.png" },
          { type: "video", name: "c.mp4" },
        ],
        field: "type",
        operator: "equals",
        value: "video",
      } as FilterEntriesArgs,
      TEST_WORKSPACE,
    );

    assertEquals(result.success, true);
    assertEquals(result.count, 2);
    assertEquals(result.itemsCount, 3);
  },
});

Deno.test({
  name: "Data Tools: transform_entries - pluck",
  async fn() {
    const result = await transformEntries(
      {
        items: [{ path: "a.txt" }, { path: "b.txt" }],
        operation: "pluck",
        field: "path",
      } as TransformEntriesArgs,
      TEST_WORKSPACE,
    );

    assertEquals(result.success, true);
    assertEquals(result.items, ["a.txt", "b.txt"]);
  },
});

Deno.test({
  name: "Data Tools: compute - evaluates expression",
  async fn() {
    const result = await compute(
      {
        expression: "a + b * 2",
        values: { a: 2, b: 3 },
      } as ComputeArgs,
      TEST_WORKSPACE,
    );

    assertEquals(result.success, true);
    assertEquals(result.result, 8);
  },
});
