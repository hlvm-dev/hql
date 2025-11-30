(fn read [path] (js/Deno.readTextFile path))
(fn write [path content] (js/Deno.writeTextFile path content))
(fn remove [path] (js/Deno.remove path))
(fn exists? [path] 
  (try 
    (js/Deno.statSync path) 
    true 
    (catch e false)))
(export [read, write, remove, exists?])
