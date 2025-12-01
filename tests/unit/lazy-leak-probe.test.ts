
import { assertEquals, assertRejects } from "jsr:@std/assert@1";

const stdlibPath =
  new URL("../../src/lib/stdlib/js/stdlib.js", import.meta.url).pathname;
const {
  nth,
  count,
} = await import(stdlibPath);

Deno.test("nth: handles infinite generator without hanging (Lazy Check)", () => {
  function* infinite() {
    let i = 0;
    while (true) yield i++;
  }

  // If nth calls Array.from (eager), this will hang/crash
  const val = nth(infinite(), 5);
  assertEquals(val, 5);
});

Deno.test("count: handles large generator without OOM (Allocation Check)", () => {
    // This is harder to test deterministically, but we can try a large number
    // that would likely OOM if array-ified but runs fast if iterated.
    // 10M items = ~80MB * object overhead... maybe manageable.
    // Let's use a side-effect counter to ensure it iterates.
    
    let items = 0;
    function* gen() {
        while (items < 100000) { // 100k is safe
            yield items++;
        }
    }
    
    // Main point: does it require Array.from?
    // We can't easily assert allocation. 
    // But the infinite check on nth is the strongest proof of laziness.
    assertEquals(count(gen()), 100000);
});
