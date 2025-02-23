import { add2 } from "./index.bundle.hql.js"

(async () => {
    console.log(await add2(2, 3));
})();