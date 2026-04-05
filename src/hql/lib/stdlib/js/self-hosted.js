// @ts-self-types="./self-hosted.d.ts"
// ===========================================================================
// AUTO-GENERATED — DO NOT EDIT
// ===========================================================================
// This file is generated from stdlib.hql by: deno task stdlib:build
// To modify stdlib functions, edit stdlib.hql and re-run the build.
// Generated header is deterministic (timestamp omitted for stable builds).
// ===========================================================================

let take__Users_seoksoonjang_dev_hql_src_hql_lib_stdlib_stdlib_hql_take, drop__Users_seoksoonjang_dev_hql_src_hql_lib_stdlib_stdlib_hql_drop, map__Users_seoksoonjang_dev_hql_src_hql_lib_stdlib_stdlib_hql_map, filter__Users_seoksoonjang_dev_hql_src_hql_lib_stdlib_stdlib_hql_filter, reduce__Users_seoksoonjang_dev_hql_src_hql_lib_stdlib_stdlib_hql_reduce, concat__Users_seoksoonjang_dev_hql_src_hql_lib_stdlib_stdlib_hql_concat, flatten__Users_seoksoonjang_dev_hql_src_hql_lib_stdlib_stdlib_hql_flatten, distinct__Users_seoksoonjang_dev_hql_src_hql_lib_stdlib_stdlib_hql_distinct, next__Users_seoksoonjang_dev_hql_src_hql_lib_stdlib_stdlib_hql_next, nth__Users_seoksoonjang_dev_hql_src_hql_lib_stdlib_stdlib_hql_nth, second__Users_seoksoonjang_dev_hql_src_hql_lib_stdlib_stdlib_hql_second, count__Users_seoksoonjang_dev_hql_src_hql_lib_stdlib_stdlib_hql_count, last__Users_seoksoonjang_dev_hql_src_hql_lib_stdlib_stdlib_hql_last, mapIndexed__Users_seoksoonjang_dev_hql_src_hql_lib_stdlib_stdlib_hql_mapIndexed, keepIndexed__Users_seoksoonjang_dev_hql_src_hql_lib_stdlib_stdlib_hql_keepIndexed, mapcat__Users_seoksoonjang_dev_hql_src_hql_lib_stdlib_stdlib_hql_mapcat, keep__Users_seoksoonjang_dev_hql_src_hql_lib_stdlib_stdlib_hql_keep, takeWhile__Users_seoksoonjang_dev_hql_src_hql_lib_stdlib_stdlib_hql_takeWhile, dropWhile__Users_seoksoonjang_dev_hql_src_hql_lib_stdlib_stdlib_hql_dropWhile, splitWith__Users_seoksoonjang_dev_hql_src_hql_lib_stdlib_stdlib_hql_splitWith, splitAt__Users_seoksoonjang_dev_hql_src_hql_lib_stdlib_stdlib_hql_splitAt, reductions__Users_seoksoonjang_dev_hql_src_hql_lib_stdlib_stdlib_hql_reductions, interpose__Users_seoksoonjang_dev_hql_src_hql_lib_stdlib_stdlib_hql_interpose, interleave__Users_seoksoonjang_dev_hql_src_hql_lib_stdlib_stdlib_hql_interleave, partition__Users_seoksoonjang_dev_hql_src_hql_lib_stdlib_stdlib_hql_partition, partitionAll__Users_seoksoonjang_dev_hql_src_hql_lib_stdlib_stdlib_hql_partitionAll, partitionBy__Users_seoksoonjang_dev_hql_src_hql_lib_stdlib_stdlib_hql_partitionBy, isEmpty__Users_seoksoonjang_dev_hql_src_hql_lib_stdlib_stdlib_hql_isEmpty, some__Users_seoksoonjang_dev_hql_src_hql_lib_stdlib_stdlib_hql_some, every__Users_seoksoonjang_dev_hql_src_hql_lib_stdlib_stdlib_hql_every, notAny__Users_seoksoonjang_dev_hql_src_hql_lib_stdlib_stdlib_hql_notAny, notEvery__Users_seoksoonjang_dev_hql_src_hql_lib_stdlib_stdlib_hql_notEvery, isSome__Users_seoksoonjang_dev_hql_src_hql_lib_stdlib_stdlib_hql_isSome, isNil__Users_seoksoonjang_dev_hql_src_hql_lib_stdlib_stdlib_hql_isNil, isEven__Users_seoksoonjang_dev_hql_src_hql_lib_stdlib_stdlib_hql_isEven, isOdd__Users_seoksoonjang_dev_hql_src_hql_lib_stdlib_stdlib_hql_isOdd, isZero__Users_seoksoonjang_dev_hql_src_hql_lib_stdlib_stdlib_hql_isZero, isPositive__Users_seoksoonjang_dev_hql_src_hql_lib_stdlib_stdlib_hql_isPositive, isNegative__Users_seoksoonjang_dev_hql_src_hql_lib_stdlib_stdlib_hql_isNegative, isNumber__Users_seoksoonjang_dev_hql_src_hql_lib_stdlib_stdlib_hql_isNumber, isString__Users_seoksoonjang_dev_hql_src_hql_lib_stdlib_stdlib_hql_isString, isBoolean__Users_seoksoonjang_dev_hql_src_hql_lib_stdlib_stdlib_hql_isBoolean, isFunction__Users_seoksoonjang_dev_hql_src_hql_lib_stdlib_stdlib_hql_isFunction, isArray__Users_seoksoonjang_dev_hql_src_hql_lib_stdlib_stdlib_hql_isArray, isObject__Users_seoksoonjang_dev_hql_src_hql_lib_stdlib_stdlib_hql_isObject, isDelay__Users_seoksoonjang_dev_hql_src_hql_lib_stdlib_stdlib_hql_isDelay, force__Users_seoksoonjang_dev_hql_src_hql_lib_stdlib_stdlib_hql_force, realized__Users_seoksoonjang_dev_hql_src_hql_lib_stdlib_stdlib_hql_realized, inc__Users_seoksoonjang_dev_hql_src_hql_lib_stdlib_stdlib_hql_inc, dec__Users_seoksoonjang_dev_hql_src_hql_lib_stdlib_stdlib_hql_dec, abs__Users_seoksoonjang_dev_hql_src_hql_lib_stdlib_stdlib_hql_abs, add__Users_seoksoonjang_dev_hql_src_hql_lib_stdlib_stdlib_hql_add, sub__Users_seoksoonjang_dev_hql_src_hql_lib_stdlib_stdlib_hql_sub, mul__Users_seoksoonjang_dev_hql_src_hql_lib_stdlib_stdlib_hql_mul, div__Users_seoksoonjang_dev_hql_src_hql_lib_stdlib_stdlib_hql_div, mod__Users_seoksoonjang_dev_hql_src_hql_lib_stdlib_stdlib_hql_mod, eq__Users_seoksoonjang_dev_hql_src_hql_lib_stdlib_stdlib_hql_eq, neq__Users_seoksoonjang_dev_hql_src_hql_lib_stdlib_stdlib_hql_neq, deepEqInternal__Users_seoksoonjang_dev_hql_src_hql_lib_stdlib_stdlib_hql_deepEqInternal, deepEq__Users_seoksoonjang_dev_hql_src_hql_lib_stdlib_stdlib_hql_deepEq, lt__Users_seoksoonjang_dev_hql_src_hql_lib_stdlib_stdlib_hql_lt, gt__Users_seoksoonjang_dev_hql_src_hql_lib_stdlib_stdlib_hql_gt, lte__Users_seoksoonjang_dev_hql_src_hql_lib_stdlib_stdlib_hql_lte, gte__Users_seoksoonjang_dev_hql_src_hql_lib_stdlib_stdlib_hql_gte, symbol__Users_seoksoonjang_dev_hql_src_hql_lib_stdlib_stdlib_hql_symbol, keyword__Users_seoksoonjang_dev_hql_src_hql_lib_stdlib_stdlib_hql_keyword, name__Users_seoksoonjang_dev_hql_src_hql_lib_stdlib_stdlib_hql_name, repeat__Users_seoksoonjang_dev_hql_src_hql_lib_stdlib_stdlib_hql_repeat, repeatedly__Users_seoksoonjang_dev_hql_src_hql_lib_stdlib_stdlib_hql_repeatedly, cycle__Users_seoksoonjang_dev_hql_src_hql_lib_stdlib_stdlib_hql_cycle, iterate__Users_seoksoonjang_dev_hql_src_hql_lib_stdlib_stdlib_hql_iterate, keys__Users_seoksoonjang_dev_hql_src_hql_lib_stdlib_stdlib_hql_keys, groupBy__Users_seoksoonjang_dev_hql_src_hql_lib_stdlib_stdlib_hql_groupBy, reverse__Users_seoksoonjang_dev_hql_src_hql_lib_stdlib_stdlib_hql_reverse, identity__Users_seoksoonjang_dev_hql_src_hql_lib_stdlib_stdlib_hql_identity, constantly__Users_seoksoonjang_dev_hql_src_hql_lib_stdlib_stdlib_hql_constantly, vals__Users_seoksoonjang_dev_hql_src_hql_lib_stdlib_stdlib_hql_vals, juxt__Users_seoksoonjang_dev_hql_src_hql_lib_stdlib_stdlib_hql_juxt, zipmap__Users_seoksoonjang_dev_hql_src_hql_lib_stdlib_stdlib_hql_zipmap, get__Users_seoksoonjang_dev_hql_src_hql_lib_stdlib_stdlib_hql_get, getIn__Users_seoksoonjang_dev_hql_src_hql_lib_stdlib_stdlib_hql_getIn, assoc__Users_seoksoonjang_dev_hql_src_hql_lib_stdlib_stdlib_hql_assoc, assocIn__Users_seoksoonjang_dev_hql_src_hql_lib_stdlib_stdlib_hql_assocIn, dissoc__Users_seoksoonjang_dev_hql_src_hql_lib_stdlib_stdlib_hql_dissoc, update__Users_seoksoonjang_dev_hql_src_hql_lib_stdlib_stdlib_hql_update, updateIn__Users_seoksoonjang_dev_hql_src_hql_lib_stdlib_stdlib_hql_updateIn, merge__Users_seoksoonjang_dev_hql_src_hql_lib_stdlib_stdlib_hql_merge, throwEmptyTypeError__Users_seoksoonjang_dev_hql_src_hql_lib_stdlib_stdlib_hql_throwEmptyTypeError, empty__Users_seoksoonjang_dev_hql_src_hql_lib_stdlib_stdlib_hql_empty, conj__Users_seoksoonjang_dev_hql_src_hql_lib_stdlib_stdlib_hql_conj, into__Users_seoksoonjang_dev_hql_src_hql_lib_stdlib_stdlib_hql_into, vec__Users_seoksoonjang_dev_hql_src_hql_lib_stdlib_stdlib_hql_vec, set__Users_seoksoonjang_dev_hql_src_hql_lib_stdlib_stdlib_hql_set, doall__Users_seoksoonjang_dev_hql_src_hql_lib_stdlib_stdlib_hql_doall, comp__Users_seoksoonjang_dev_hql_src_hql_lib_stdlib_stdlib_hql_comp, partial__Users_seoksoonjang_dev_hql_src_hql_lib_stdlib_stdlib_hql_partial, apply__Users_seoksoonjang_dev_hql_src_hql_lib_stdlib_stdlib_hql_apply, sort__Users_seoksoonjang_dev_hql_src_hql_lib_stdlib_stdlib_hql_sort, sortBy__Users_seoksoonjang_dev_hql_src_hql_lib_stdlib_stdlib_hql_sortBy, mapT__Users_seoksoonjang_dev_hql_src_hql_lib_stdlib_stdlib_hql_mapT, filterT__Users_seoksoonjang_dev_hql_src_hql_lib_stdlib_stdlib_hql_filterT, takeT__Users_seoksoonjang_dev_hql_src_hql_lib_stdlib_stdlib_hql_takeT, dropT__Users_seoksoonjang_dev_hql_src_hql_lib_stdlib_stdlib_hql_dropT, takeWhileT__Users_seoksoonjang_dev_hql_src_hql_lib_stdlib_stdlib_hql_takeWhileT, dropWhileT__Users_seoksoonjang_dev_hql_src_hql_lib_stdlib_stdlib_hql_dropWhileT, distinctT__Users_seoksoonjang_dev_hql_src_hql_lib_stdlib_stdlib_hql_distinctT, partitionAllT__Users_seoksoonjang_dev_hql_src_hql_lib_stdlib_stdlib_hql_partitionAllT, composeTransducers__Users_seoksoonjang_dev_hql_src_hql_lib_stdlib_stdlib_hql_composeTransducers, frequencies__Users_seoksoonjang_dev_hql_src_hql_lib_stdlib_stdlib_hql_frequencies, selectKeys__Users_seoksoonjang_dev_hql_src_hql_lib_stdlib_stdlib_hql_selectKeys, mergeWith__Users_seoksoonjang_dev_hql_src_hql_lib_stdlib_stdlib_hql_mergeWith, remove__Users_seoksoonjang_dev_hql_src_hql_lib_stdlib_stdlib_hql_remove, complement__Users_seoksoonjang_dev_hql_src_hql_lib_stdlib_stdlib_hql_complement, memoize__Users_seoksoonjang_dev_hql_src_hql_lib_stdlib_stdlib_hql_memoize, notEmpty__Users_seoksoonjang_dev_hql_src_hql_lib_stdlib_stdlib_hql_notEmpty, boundedCount__Users_seoksoonjang_dev_hql_src_hql_lib_stdlib_stdlib_hql_boundedCount, runBang__Users_seoksoonjang_dev_hql_src_hql_lib_stdlib_stdlib_hql_runBang, everyPred__Users_seoksoonjang_dev_hql_src_hql_lib_stdlib_stdlib_hql_everyPred, someFn__Users_seoksoonjang_dev_hql_src_hql_lib_stdlib_stdlib_hql_someFn, cat__Users_seoksoonjang_dev_hql_src_hql_lib_stdlib_stdlib_hql_cat, dedupe__Users_seoksoonjang_dev_hql_src_hql_lib_stdlib_stdlib_hql_dedupe, removeT__Users_seoksoonjang_dev_hql_src_hql_lib_stdlib_stdlib_hql_removeT, keepT__Users_seoksoonjang_dev_hql_src_hql_lib_stdlib_stdlib_hql_keepT, min__Users_seoksoonjang_dev_hql_src_hql_lib_stdlib_stdlib_hql_min, max__Users_seoksoonjang_dev_hql_src_hql_lib_stdlib_stdlib_hql_max, fnil__Users_seoksoonjang_dev_hql_src_hql_lib_stdlib_stdlib_hql_fnil, trampoline__Users_seoksoonjang_dev_hql_src_hql_lib_stdlib_stdlib_hql_trampoline, strJoin__Users_seoksoonjang_dev_hql_src_hql_lib_stdlib_stdlib_hql_strJoin, split__Users_seoksoonjang_dev_hql_src_hql_lib_stdlib_stdlib_hql_split, replace___Users_seoksoonjang_dev_hql_src_hql_lib_stdlib_stdlib_hql_replace, trim__Users_seoksoonjang_dev_hql_src_hql_lib_stdlib_stdlib_hql_trim, upperCase__Users_seoksoonjang_dev_hql_src_hql_lib_stdlib_stdlib_hql_upperCase, lowerCase__Users_seoksoonjang_dev_hql_src_hql_lib_stdlib_stdlib_hql_lowerCase, startsWith__Users_seoksoonjang_dev_hql_src_hql_lib_stdlib_stdlib_hql_startsWith, endsWith__Users_seoksoonjang_dev_hql_src_hql_lib_stdlib_stdlib_hql_endsWith, includes__Users_seoksoonjang_dev_hql_src_hql_lib_stdlib_stdlib_hql_includes, subs__Users_seoksoonjang_dev_hql_src_hql_lib_stdlib_stdlib_hql_subs, isKeyword__Users_seoksoonjang_dev_hql_src_hql_lib_stdlib_stdlib_hql_isKeyword, isSymbol__Users_seoksoonjang_dev_hql_src_hql_lib_stdlib_stdlib_hql_isSymbol, isSeqable__Users_seoksoonjang_dev_hql_src_hql_lib_stdlib_stdlib_hql_isSeqable, isVector__Users_seoksoonjang_dev_hql_src_hql_lib_stdlib_stdlib_hql_isVector, isMap__Users_seoksoonjang_dev_hql_src_hql_lib_stdlib_stdlib_hql_isMap, isSet__Users_seoksoonjang_dev_hql_src_hql_lib_stdlib_stdlib_hql_isSet, isInt__Users_seoksoonjang_dev_hql_src_hql_lib_stdlib_stdlib_hql_isInt, isFloat__Users_seoksoonjang_dev_hql_src_hql_lib_stdlib_stdlib_hql_isFloat, mapcatT__Users_seoksoonjang_dev_hql_src_hql_lib_stdlib_stdlib_hql_mapcatT;
import { first, rest, cons, seq, range, __hql_lazy_seq, __hql_hash_map, intoXform, first as first__Users_seoksoonjang_dev_hql_src_hql_lib_stdlib_js_core_js_first, rest as rest__Users_seoksoonjang_dev_hql_src_hql_lib_stdlib_js_core_js_rest, cons as cons__Users_seoksoonjang_dev_hql_src_hql_lib_stdlib_js_core_js_cons, seq as seq__Users_seoksoonjang_dev_hql_src_hql_lib_stdlib_js_core_js_seq, lazySeq as lazySeq__Users_seoksoonjang_dev_hql_src_hql_lib_stdlib_js_core_js_lazySeq, range as range__Users_seoksoonjang_dev_hql_src_hql_lib_stdlib_js_core_js_range, chunkedMap as chunkedMap__Users_seoksoonjang_dev_hql_src_hql_lib_stdlib_js_core_js_chunkedMap, chunkedFilter as chunkedFilter__Users_seoksoonjang_dev_hql_src_hql_lib_stdlib_js_core_js_chunkedFilter, chunkedReduce as chunkedReduce__Users_seoksoonjang_dev_hql_src_hql_lib_stdlib_js_core_js_chunkedReduce } from "./core.js";
import { shouldChunk as shouldChunk__Users_seoksoonjang_dev_hql_src_hql_lib_stdlib_js_internal_seq_protocol_js_shouldChunk, Delay as Delay__Users_seoksoonjang_dev_hql_src_hql_lib_stdlib_js_internal_seq_protocol_js_Delay, LazySeq as LazySeq__Users_seoksoonjang_dev_hql_src_hql_lib_stdlib_js_internal_seq_protocol_js_LazySeq, reduced as reduced__Users_seoksoonjang_dev_hql_src_hql_lib_stdlib_js_internal_seq_protocol_js_reduced, isReduced as isReduced__Users_seoksoonjang_dev_hql_src_hql_lib_stdlib_js_internal_seq_protocol_js_isReduced, ensureReduced as ensureReduced__Users_seoksoonjang_dev_hql_src_hql_lib_stdlib_js_internal_seq_protocol_js_ensureReduced, TRANSDUCER_INIT as TRANSDUCER_INIT__Users_seoksoonjang_dev_hql_src_hql_lib_stdlib_js_internal_seq_protocol_js_TRANSDUCER_INIT, TRANSDUCER_STEP as TRANSDUCER_STEP__Users_seoksoonjang_dev_hql_src_hql_lib_stdlib_js_internal_seq_protocol_js_TRANSDUCER_STEP, TRANSDUCER_RESULT as TRANSDUCER_RESULT__Users_seoksoonjang_dev_hql_src_hql_lib_stdlib_js_internal_seq_protocol_js_TRANSDUCER_RESULT, reduced, isReduced } from "./internal/seq-protocol.js";
(take__Users_seoksoonjang_dev_hql_src_hql_lib_stdlib_stdlib_hql_take = function take__Users_seoksoonjang_dev_hql_src_hql_lib_stdlib_stdlib_hql_take(n, coll) {
    return __hql_lazy_seq(() => n > 0 ? ((s__local_macro_local_8) => s__local_macro_local_8 ? cons__Users_seoksoonjang_dev_hql_src_hql_lib_stdlib_js_core_js_cons(first__Users_seoksoonjang_dev_hql_src_hql_lib_stdlib_js_core_js_first(s__local_macro_local_8), take__Users_seoksoonjang_dev_hql_src_hql_lib_stdlib_stdlib_hql_take(n - 1, rest__Users_seoksoonjang_dev_hql_src_hql_lib_stdlib_js_core_js_rest(s__local_macro_local_8))) : null)(seq__Users_seoksoonjang_dev_hql_src_hql_lib_stdlib_js_core_js_seq(coll)) : null);
});
(drop__Users_seoksoonjang_dev_hql_src_hql_lib_stdlib_stdlib_hql_drop = function drop__Users_seoksoonjang_dev_hql_src_hql_lib_stdlib_stdlib_hql_drop(n, coll) {
    return __hql_lazy_seq(() => ((__init_0, __init_1) => {
        let s = __init_0;
        let remaining = __init_1;
        while (s && remaining > 0) {
            const __hql_temp_s = seq__Users_seoksoonjang_dev_hql_src_hql_lib_stdlib_js_core_js_seq(rest__Users_seoksoonjang_dev_hql_src_hql_lib_stdlib_js_core_js_rest(s));
            s = __hql_temp_s;
            remaining--;
        }
        return s;
    })(seq__Users_seoksoonjang_dev_hql_src_hql_lib_stdlib_js_core_js_seq(coll), n));
});
(map__Users_seoksoonjang_dev_hql_src_hql_lib_stdlib_stdlib_hql_map = function map__Users_seoksoonjang_dev_hql_src_hql_lib_stdlib_stdlib_hql_map(f, ...colls) {
    if (typeof f === "function" ? false : true) {
        throw TypeError("map: first argument must be a function, got " + typeof f);
    }
    else {
        null;
    }
    if (isNil(seq__Users_seoksoonjang_dev_hql_src_hql_lib_stdlib_js_core_js_seq(colls))) {
        throw TypeError("map: requires at least one collection");
    }
    else {
        null;
    }
    return isNil(seq__Users_seoksoonjang_dev_hql_src_hql_lib_stdlib_js_core_js_seq(rest__Users_seoksoonjang_dev_hql_src_hql_lib_stdlib_js_core_js_rest(colls))) ? (() => {
        let coll = first__Users_seoksoonjang_dev_hql_src_hql_lib_stdlib_js_core_js_first(colls);
        return shouldChunk__Users_seoksoonjang_dev_hql_src_hql_lib_stdlib_js_internal_seq_protocol_js_shouldChunk(coll) ? chunkedMap__Users_seoksoonjang_dev_hql_src_hql_lib_stdlib_js_core_js_chunkedMap(f, coll) : __hql_lazy_seq(() => ((s__local_macro_local_25) => s__local_macro_local_25 ? cons__Users_seoksoonjang_dev_hql_src_hql_lib_stdlib_js_core_js_cons(f(first__Users_seoksoonjang_dev_hql_src_hql_lib_stdlib_js_core_js_first(s__local_macro_local_25)), map__Users_seoksoonjang_dev_hql_src_hql_lib_stdlib_stdlib_hql_map(f, rest__Users_seoksoonjang_dev_hql_src_hql_lib_stdlib_js_core_js_rest(s__local_macro_local_25))) : null)(seq__Users_seoksoonjang_dev_hql_src_hql_lib_stdlib_js_core_js_seq(coll)));
    })() : (() => {
        let mapMulti;
        (mapMulti = (mapMulti = function mapMulti(colls) {
            return __hql_lazy_seq(() => (() => {
                let ss = vec__Users_seoksoonjang_dev_hql_src_hql_lib_stdlib_stdlib_hql_vec(map__Users_seoksoonjang_dev_hql_src_hql_lib_stdlib_stdlib_hql_map(seq__Users_seoksoonjang_dev_hql_src_hql_lib_stdlib_js_core_js_seq, colls));
                return every__Users_seoksoonjang_dev_hql_src_hql_lib_stdlib_stdlib_hql_every(identity__Users_seoksoonjang_dev_hql_src_hql_lib_stdlib_stdlib_hql_identity, ss) ? cons__Users_seoksoonjang_dev_hql_src_hql_lib_stdlib_js_core_js_cons(apply__Users_seoksoonjang_dev_hql_src_hql_lib_stdlib_stdlib_hql_apply(f, vec__Users_seoksoonjang_dev_hql_src_hql_lib_stdlib_stdlib_hql_vec(map__Users_seoksoonjang_dev_hql_src_hql_lib_stdlib_stdlib_hql_map(first__Users_seoksoonjang_dev_hql_src_hql_lib_stdlib_js_core_js_first, ss))), mapMulti(map__Users_seoksoonjang_dev_hql_src_hql_lib_stdlib_stdlib_hql_map(rest__Users_seoksoonjang_dev_hql_src_hql_lib_stdlib_js_core_js_rest, ss))) : null;
            })());
        }));
        return mapMulti(colls);
    })();
});
(filter__Users_seoksoonjang_dev_hql_src_hql_lib_stdlib_stdlib_hql_filter = function filter__Users_seoksoonjang_dev_hql_src_hql_lib_stdlib_stdlib_hql_filter(pred, coll) {
    if (typeof pred === "function" ? false : true) {
        throw TypeError("filter: predicate must be a function, got " + typeof pred);
    }
    else {
        null;
    }
    return shouldChunk__Users_seoksoonjang_dev_hql_src_hql_lib_stdlib_js_internal_seq_protocol_js_shouldChunk(coll) ? chunkedFilter__Users_seoksoonjang_dev_hql_src_hql_lib_stdlib_js_core_js_chunkedFilter(pred, coll) : __hql_lazy_seq(() => ((s__local_macro_local_38) => s__local_macro_local_38 ? (() => {
        let f = first__Users_seoksoonjang_dev_hql_src_hql_lib_stdlib_js_core_js_first(s__local_macro_local_38);
        return pred(f) ? cons__Users_seoksoonjang_dev_hql_src_hql_lib_stdlib_js_core_js_cons(f, filter__Users_seoksoonjang_dev_hql_src_hql_lib_stdlib_stdlib_hql_filter(pred, rest__Users_seoksoonjang_dev_hql_src_hql_lib_stdlib_js_core_js_rest(s__local_macro_local_38))) : filter__Users_seoksoonjang_dev_hql_src_hql_lib_stdlib_stdlib_hql_filter(pred, rest__Users_seoksoonjang_dev_hql_src_hql_lib_stdlib_js_core_js_rest(s__local_macro_local_38));
    })() : null)(seq__Users_seoksoonjang_dev_hql_src_hql_lib_stdlib_js_core_js_seq(coll)));
});
(reduce__Users_seoksoonjang_dev_hql_src_hql_lib_stdlib_stdlib_hql_reduce = function reduce__Users_seoksoonjang_dev_hql_src_hql_lib_stdlib_stdlib_hql_reduce(f, ...args) {
    if (typeof f === "function" ? false : true) {
        throw TypeError("reduce: reducer must be a function, got " + typeof f);
    }
    else {
        null;
    }
    if (isNil(seq__Users_seoksoonjang_dev_hql_src_hql_lib_stdlib_js_core_js_seq(args)) || seq__Users_seoksoonjang_dev_hql_src_hql_lib_stdlib_js_core_js_seq(rest__Users_seoksoonjang_dev_hql_src_hql_lib_stdlib_js_core_js_rest(args)) && seq__Users_seoksoonjang_dev_hql_src_hql_lib_stdlib_js_core_js_seq(rest__Users_seoksoonjang_dev_hql_src_hql_lib_stdlib_js_core_js_rest(rest__Users_seoksoonjang_dev_hql_src_hql_lib_stdlib_js_core_js_rest(args)))) {
        throw TypeError("reduce: expects 2 or 3 arguments");
    }
    else {
        null;
    }
    return isNil(seq__Users_seoksoonjang_dev_hql_src_hql_lib_stdlib_js_core_js_seq(rest__Users_seoksoonjang_dev_hql_src_hql_lib_stdlib_js_core_js_rest(args))) ? (() => {
        let coll = first__Users_seoksoonjang_dev_hql_src_hql_lib_stdlib_js_core_js_first(args);
        let s = seq__Users_seoksoonjang_dev_hql_src_hql_lib_stdlib_js_core_js_seq(coll);
        return s ? chunkedReduce__Users_seoksoonjang_dev_hql_src_hql_lib_stdlib_js_core_js_chunkedReduce(f, first__Users_seoksoonjang_dev_hql_src_hql_lib_stdlib_js_core_js_first(s), rest__Users_seoksoonjang_dev_hql_src_hql_lib_stdlib_js_core_js_rest(s)) : f();
    })() : chunkedReduce__Users_seoksoonjang_dev_hql_src_hql_lib_stdlib_js_core_js_chunkedReduce(f, first__Users_seoksoonjang_dev_hql_src_hql_lib_stdlib_js_core_js_first(args), second__Users_seoksoonjang_dev_hql_src_hql_lib_stdlib_stdlib_hql_second(args));
});
(concat__Users_seoksoonjang_dev_hql_src_hql_lib_stdlib_stdlib_hql_concat = function concat__Users_seoksoonjang_dev_hql_src_hql_lib_stdlib_stdlib_hql_concat(...colls) {
    return (() => {
        let cat;
        (cat = (cat = function cat(remaining) {
            return __hql_lazy_seq(() => ((__init_0) => {
                function loop_1(cs) {
                    return ((seqd__local_macro_local_57) => seqd__local_macro_local_57 ? ((s__local_macro_local_66) => {
                        if (s__local_macro_local_66) {
                            return cons__Users_seoksoonjang_dev_hql_src_hql_lib_stdlib_js_core_js_cons(first__Users_seoksoonjang_dev_hql_src_hql_lib_stdlib_js_core_js_first(s__local_macro_local_66), cat(cons__Users_seoksoonjang_dev_hql_src_hql_lib_stdlib_js_core_js_cons(rest__Users_seoksoonjang_dev_hql_src_hql_lib_stdlib_js_core_js_rest(s__local_macro_local_66), rest__Users_seoksoonjang_dev_hql_src_hql_lib_stdlib_js_core_js_rest(seqd__local_macro_local_57))));
                        }
                        else {
                            return loop_1(rest__Users_seoksoonjang_dev_hql_src_hql_lib_stdlib_js_core_js_rest(seqd__local_macro_local_57));
                        }
                    })(seq__Users_seoksoonjang_dev_hql_src_hql_lib_stdlib_js_core_js_seq(first__Users_seoksoonjang_dev_hql_src_hql_lib_stdlib_js_core_js_first(seqd__local_macro_local_57))) : null)(seq__Users_seoksoonjang_dev_hql_src_hql_lib_stdlib_js_core_js_seq(cs));
                }
                return loop_1(__init_0);
            })(remaining));
        }));
        return cat(colls);
    })();
});
(flatten__Users_seoksoonjang_dev_hql_src_hql_lib_stdlib_stdlib_hql_flatten = function flatten__Users_seoksoonjang_dev_hql_src_hql_lib_stdlib_stdlib_hql_flatten(coll) {
    return (() => {
        let sequential_QMARK_ = (x) => (isNil(x) ? false : true) && ((typeof x === "string" ? false : true) && (Array.isArray(x) || typeof x === "object" && x !== null && !Array.isArray(x) && (typeof x.first === "function" && typeof x.rest === "function")));
        return __hql_lazy_seq(() => ((s__local_macro_local_93) => s__local_macro_local_93 ? (() => {
            let f = first__Users_seoksoonjang_dev_hql_src_hql_lib_stdlib_js_core_js_first(s__local_macro_local_93);
            return sequential_QMARK_(f) ? concat__Users_seoksoonjang_dev_hql_src_hql_lib_stdlib_stdlib_hql_concat(flatten__Users_seoksoonjang_dev_hql_src_hql_lib_stdlib_stdlib_hql_flatten(f), flatten__Users_seoksoonjang_dev_hql_src_hql_lib_stdlib_stdlib_hql_flatten(rest__Users_seoksoonjang_dev_hql_src_hql_lib_stdlib_js_core_js_rest(s__local_macro_local_93))) : cons__Users_seoksoonjang_dev_hql_src_hql_lib_stdlib_js_core_js_cons(f, flatten__Users_seoksoonjang_dev_hql_src_hql_lib_stdlib_stdlib_hql_flatten(rest__Users_seoksoonjang_dev_hql_src_hql_lib_stdlib_js_core_js_rest(s__local_macro_local_93)));
        })() : null)(seq__Users_seoksoonjang_dev_hql_src_hql_lib_stdlib_js_core_js_seq(coll)));
    })();
});
(distinct__Users_seoksoonjang_dev_hql_src_hql_lib_stdlib_stdlib_hql_distinct = function distinct__Users_seoksoonjang_dev_hql_src_hql_lib_stdlib_stdlib_hql_distinct(coll) {
    return (() => {
        let seen = new Set();
        return (() => {
            let step = (s) => __hql_lazy_seq(() => ((xs__local_macro_local_101) => xs__local_macro_local_101 ? (() => {
                let f = first__Users_seoksoonjang_dev_hql_src_hql_lib_stdlib_js_core_js_first(xs__local_macro_local_101);
                return seen.has(f) ? step(rest__Users_seoksoonjang_dev_hql_src_hql_lib_stdlib_js_core_js_rest(xs__local_macro_local_101)) : ((seen.add(f), cons__Users_seoksoonjang_dev_hql_src_hql_lib_stdlib_js_core_js_cons(f, step(rest__Users_seoksoonjang_dev_hql_src_hql_lib_stdlib_js_core_js_rest(xs__local_macro_local_101)))));
            })() : null)(seq__Users_seoksoonjang_dev_hql_src_hql_lib_stdlib_js_core_js_seq(s)));
            return step(coll);
        })();
    })();
});
(next__Users_seoksoonjang_dev_hql_src_hql_lib_stdlib_stdlib_hql_next = function next__Users_seoksoonjang_dev_hql_src_hql_lib_stdlib_stdlib_hql_next(coll) {
    return seq__Users_seoksoonjang_dev_hql_src_hql_lib_stdlib_js_core_js_seq(rest__Users_seoksoonjang_dev_hql_src_hql_lib_stdlib_js_core_js_rest(coll));
});
(nth__Users_seoksoonjang_dev_hql_src_hql_lib_stdlib_stdlib_hql_nth = function nth__Users_seoksoonjang_dev_hql_src_hql_lib_stdlib_stdlib_hql_nth(coll, index, ...args) {
    try {
        if ((typeof index === "number" ? false : true) || (index < 0 || (index === Math.floor(index) ? false : true))) {
            throw TypeError("nth: index must be non-negative integer, got " + index);
        }
        else {
            null;
        }
        return (() => {
            let not_found = first__Users_seoksoonjang_dev_hql_src_hql_lib_stdlib_js_core_js_first(args);
            let has_not_found = seq__Users_seoksoonjang_dev_hql_src_hql_lib_stdlib_js_core_js_seq(args);
            if (isNil(coll)) {
                if (has_not_found) {
                    return not_found;
                }
                else {
                    ((() => { throw Error("nth: index " + index + " out of bounds for null collection"); })());
                }
            }
            else {
                return Array.isArray(coll) || typeof coll === "string" ? (() => {
                    let len = coll.length;
                    if (index < len) {
                        return coll[index];
                    }
                    else if (has_not_found) {
                        return not_found;
                    }
                    else {
                        ((() => { throw Error("nth: index " + index + " out of bounds (length " + len + ")"); })());
                    }
                })() : typeof coll.count === "function" && typeof coll.nth === "function" ? (() => {
                    let len = coll.count();
                    if (index < len) {
                        return coll.nth(index);
                    }
                    else if (has_not_found) {
                        return not_found;
                    }
                    else {
                        ((() => { throw Error("nth: index " + index + " out of bounds"); })());
                    }
                })() : ((__init_0, __init_1) => {
                    function loop_2(s, i) {
                        if (s) {
                            if (i === index) {
                                return first__Users_seoksoonjang_dev_hql_src_hql_lib_stdlib_js_core_js_first(s);
                            }
                            else {
                                return loop_2(seq__Users_seoksoonjang_dev_hql_src_hql_lib_stdlib_js_core_js_seq(rest__Users_seoksoonjang_dev_hql_src_hql_lib_stdlib_js_core_js_rest(s)), i + 1);
                            }
                        }
                        else if (has_not_found) {
                            return not_found;
                        }
                        else {
                            ((() => { throw Error("nth: index " + index + " out of bounds"); })());
                        }
                    }
                    return loop_2(__init_0, __init_1);
                })(seq__Users_seoksoonjang_dev_hql_src_hql_lib_stdlib_js_core_js_seq(coll), 0);
            }
        })();
    }
    catch (__hql_ret__) {
        if (__hql_ret__ && __hql_ret__.__hql_early_return__) {
            return __hql_ret__.value;
        }
        else {
            throw __hql_ret__;
        }
    }
});
(second__Users_seoksoonjang_dev_hql_src_hql_lib_stdlib_stdlib_hql_second = function second__Users_seoksoonjang_dev_hql_src_hql_lib_stdlib_stdlib_hql_second(coll) {
    return nth__Users_seoksoonjang_dev_hql_src_hql_lib_stdlib_stdlib_hql_nth(coll, 1, null);
});
(count__Users_seoksoonjang_dev_hql_src_hql_lib_stdlib_stdlib_hql_count = function count__Users_seoksoonjang_dev_hql_src_hql_lib_stdlib_stdlib_hql_count(coll) {
    return isNil(coll) ? 0 : Array.isArray(coll) || typeof coll === "string" ? coll.length : typeof coll.count === "function" ? coll.count() : ((__init_0, __init_1) => {
        let s = __init_0;
        let n = __init_1;
        while (s) {
            const __hql_temp_s = seq__Users_seoksoonjang_dev_hql_src_hql_lib_stdlib_js_core_js_seq(rest__Users_seoksoonjang_dev_hql_src_hql_lib_stdlib_js_core_js_rest(s));
            s = __hql_temp_s;
            n++;
        }
        return n;
    })(seq__Users_seoksoonjang_dev_hql_src_hql_lib_stdlib_js_core_js_seq(coll), 0);
});
(last__Users_seoksoonjang_dev_hql_src_hql_lib_stdlib_stdlib_hql_last = function last__Users_seoksoonjang_dev_hql_src_hql_lib_stdlib_stdlib_hql_last(coll) {
    return isNil(coll) ? null : Array.isArray(coll) ? coll.length > 0 ? coll[coll.length - 1] : null : ((__init_0, __init_1) => {
        let s = __init_0;
        let result = __init_1;
        while (s) {
            const __hql_temp_s = seq__Users_seoksoonjang_dev_hql_src_hql_lib_stdlib_js_core_js_seq(rest__Users_seoksoonjang_dev_hql_src_hql_lib_stdlib_js_core_js_rest(s));
            const __hql_temp_result = first__Users_seoksoonjang_dev_hql_src_hql_lib_stdlib_js_core_js_first(s);
            s = __hql_temp_s;
            result = __hql_temp_result;
        }
        return result;
    })(seq__Users_seoksoonjang_dev_hql_src_hql_lib_stdlib_js_core_js_seq(coll), null);
});
(mapIndexed__Users_seoksoonjang_dev_hql_src_hql_lib_stdlib_stdlib_hql_mapIndexed = function mapIndexed__Users_seoksoonjang_dev_hql_src_hql_lib_stdlib_stdlib_hql_mapIndexed(f, coll) {
    if (typeof f === "function" ? false : true) {
        throw TypeError("mapIndexed: first argument must be a function, got " + typeof f);
    }
    else {
        null;
    }
    return (() => {
        let step = (s, idx) => __hql_lazy_seq(() => ((xs__local_macro_local_140) => xs__local_macro_local_140 ? cons__Users_seoksoonjang_dev_hql_src_hql_lib_stdlib_js_core_js_cons(f(idx, first__Users_seoksoonjang_dev_hql_src_hql_lib_stdlib_js_core_js_first(xs__local_macro_local_140)), step(rest__Users_seoksoonjang_dev_hql_src_hql_lib_stdlib_js_core_js_rest(xs__local_macro_local_140), idx + 1)) : null)(seq__Users_seoksoonjang_dev_hql_src_hql_lib_stdlib_js_core_js_seq(s)));
        return step(coll, 0);
    })();
});
(keepIndexed__Users_seoksoonjang_dev_hql_src_hql_lib_stdlib_stdlib_hql_keepIndexed = function keepIndexed__Users_seoksoonjang_dev_hql_src_hql_lib_stdlib_stdlib_hql_keepIndexed(f, coll) {
    if (typeof f === "function" ? false : true) {
        throw TypeError("keepIndexed: first argument must be a function, got " + typeof f);
    }
    else {
        null;
    }
    return (() => {
        let step = (s, idx) => __hql_lazy_seq(() => ((xs__local_macro_local_153) => xs__local_macro_local_153 ? (() => {
            let result = f(idx, first__Users_seoksoonjang_dev_hql_src_hql_lib_stdlib_js_core_js_first(xs__local_macro_local_153));
            return isSome__Users_seoksoonjang_dev_hql_src_hql_lib_stdlib_stdlib_hql_isSome(result) ? cons__Users_seoksoonjang_dev_hql_src_hql_lib_stdlib_js_core_js_cons(result, step(rest__Users_seoksoonjang_dev_hql_src_hql_lib_stdlib_js_core_js_rest(xs__local_macro_local_153), idx + 1)) : step(rest__Users_seoksoonjang_dev_hql_src_hql_lib_stdlib_js_core_js_rest(xs__local_macro_local_153), idx + 1);
        })() : null)(seq__Users_seoksoonjang_dev_hql_src_hql_lib_stdlib_js_core_js_seq(s)));
        return step(coll, 0);
    })();
});
(mapcat__Users_seoksoonjang_dev_hql_src_hql_lib_stdlib_stdlib_hql_mapcat = function mapcat__Users_seoksoonjang_dev_hql_src_hql_lib_stdlib_stdlib_hql_mapcat(f, coll) {
    return __hql_lazy_seq(() => ((s__local_macro_local_161) => s__local_macro_local_161 ? concat__Users_seoksoonjang_dev_hql_src_hql_lib_stdlib_stdlib_hql_concat(f(first__Users_seoksoonjang_dev_hql_src_hql_lib_stdlib_js_core_js_first(s__local_macro_local_161)), mapcat__Users_seoksoonjang_dev_hql_src_hql_lib_stdlib_stdlib_hql_mapcat(f, rest__Users_seoksoonjang_dev_hql_src_hql_lib_stdlib_js_core_js_rest(s__local_macro_local_161))) : null)(seq__Users_seoksoonjang_dev_hql_src_hql_lib_stdlib_js_core_js_seq(coll)));
});
(keep__Users_seoksoonjang_dev_hql_src_hql_lib_stdlib_stdlib_hql_keep = function keep__Users_seoksoonjang_dev_hql_src_hql_lib_stdlib_stdlib_hql_keep(f, coll) {
    return __hql_lazy_seq(() => ((s__local_macro_local_169) => s__local_macro_local_169 ? (() => {
        let result = f(first__Users_seoksoonjang_dev_hql_src_hql_lib_stdlib_js_core_js_first(s__local_macro_local_169));
        return isSome__Users_seoksoonjang_dev_hql_src_hql_lib_stdlib_stdlib_hql_isSome(result) ? cons__Users_seoksoonjang_dev_hql_src_hql_lib_stdlib_js_core_js_cons(result, keep__Users_seoksoonjang_dev_hql_src_hql_lib_stdlib_stdlib_hql_keep(f, rest__Users_seoksoonjang_dev_hql_src_hql_lib_stdlib_js_core_js_rest(s__local_macro_local_169))) : keep__Users_seoksoonjang_dev_hql_src_hql_lib_stdlib_stdlib_hql_keep(f, rest__Users_seoksoonjang_dev_hql_src_hql_lib_stdlib_js_core_js_rest(s__local_macro_local_169));
    })() : null)(seq__Users_seoksoonjang_dev_hql_src_hql_lib_stdlib_js_core_js_seq(coll)));
});
(takeWhile__Users_seoksoonjang_dev_hql_src_hql_lib_stdlib_stdlib_hql_takeWhile = function takeWhile__Users_seoksoonjang_dev_hql_src_hql_lib_stdlib_stdlib_hql_takeWhile(pred, coll) {
    if (typeof pred === "function" ? false : true) {
        throw TypeError("takeWhile: predicate must be a function");
    }
    else {
        null;
    }
    return __hql_lazy_seq(() => ((s__local_macro_local_181) => s__local_macro_local_181 ? (() => {
        let f = first__Users_seoksoonjang_dev_hql_src_hql_lib_stdlib_js_core_js_first(s__local_macro_local_181);
        return pred(f) ? cons__Users_seoksoonjang_dev_hql_src_hql_lib_stdlib_js_core_js_cons(f, takeWhile__Users_seoksoonjang_dev_hql_src_hql_lib_stdlib_stdlib_hql_takeWhile(pred, rest__Users_seoksoonjang_dev_hql_src_hql_lib_stdlib_js_core_js_rest(s__local_macro_local_181))) : null;
    })() : null)(seq__Users_seoksoonjang_dev_hql_src_hql_lib_stdlib_js_core_js_seq(coll)));
});
(dropWhile__Users_seoksoonjang_dev_hql_src_hql_lib_stdlib_stdlib_hql_dropWhile = function dropWhile__Users_seoksoonjang_dev_hql_src_hql_lib_stdlib_stdlib_hql_dropWhile(pred, coll) {
    return __hql_lazy_seq(() => ((__init_0) => {
        let s = __init_0;
        while (s && pred(first__Users_seoksoonjang_dev_hql_src_hql_lib_stdlib_js_core_js_first(s))) {
            const __hql_temp_s = seq__Users_seoksoonjang_dev_hql_src_hql_lib_stdlib_js_core_js_seq(rest__Users_seoksoonjang_dev_hql_src_hql_lib_stdlib_js_core_js_rest(s));
            s = __hql_temp_s;
        }
        return s ? cons__Users_seoksoonjang_dev_hql_src_hql_lib_stdlib_js_core_js_cons(first__Users_seoksoonjang_dev_hql_src_hql_lib_stdlib_js_core_js_first(s), rest__Users_seoksoonjang_dev_hql_src_hql_lib_stdlib_js_core_js_rest(s)) : null;
    })(seq__Users_seoksoonjang_dev_hql_src_hql_lib_stdlib_js_core_js_seq(coll)));
});
(splitWith__Users_seoksoonjang_dev_hql_src_hql_lib_stdlib_stdlib_hql_splitWith = function splitWith__Users_seoksoonjang_dev_hql_src_hql_lib_stdlib_stdlib_hql_splitWith(pred, coll) {
    return [doall__Users_seoksoonjang_dev_hql_src_hql_lib_stdlib_stdlib_hql_doall(takeWhile__Users_seoksoonjang_dev_hql_src_hql_lib_stdlib_stdlib_hql_takeWhile(pred, coll)), doall__Users_seoksoonjang_dev_hql_src_hql_lib_stdlib_stdlib_hql_doall(dropWhile__Users_seoksoonjang_dev_hql_src_hql_lib_stdlib_stdlib_hql_dropWhile(pred, coll))];
});
(splitAt__Users_seoksoonjang_dev_hql_src_hql_lib_stdlib_stdlib_hql_splitAt = function splitAt__Users_seoksoonjang_dev_hql_src_hql_lib_stdlib_stdlib_hql_splitAt(n, coll) {
    return [doall__Users_seoksoonjang_dev_hql_src_hql_lib_stdlib_stdlib_hql_doall(take__Users_seoksoonjang_dev_hql_src_hql_lib_stdlib_stdlib_hql_take(n, coll)), doall__Users_seoksoonjang_dev_hql_src_hql_lib_stdlib_stdlib_hql_doall(drop__Users_seoksoonjang_dev_hql_src_hql_lib_stdlib_stdlib_hql_drop(n, coll))];
});
(reductions__Users_seoksoonjang_dev_hql_src_hql_lib_stdlib_stdlib_hql_reductions = function reductions__Users_seoksoonjang_dev_hql_src_hql_lib_stdlib_stdlib_hql_reductions(f, ...args) {
    return (() => {
        let reductions_with_init;
        (reductions_with_init = (reductions_with_init = function reductions_with_init(f, init, coll) {
            return cons__Users_seoksoonjang_dev_hql_src_hql_lib_stdlib_js_core_js_cons(init, __hql_lazy_seq(() => ((s__local_macro_local_195) => s__local_macro_local_195 ? reductions_with_init(f, f(init, first__Users_seoksoonjang_dev_hql_src_hql_lib_stdlib_js_core_js_first(s__local_macro_local_195)), rest__Users_seoksoonjang_dev_hql_src_hql_lib_stdlib_js_core_js_rest(s__local_macro_local_195)) : null)(seq__Users_seoksoonjang_dev_hql_src_hql_lib_stdlib_js_core_js_seq(coll))));
        }));
        return isNil(seq__Users_seoksoonjang_dev_hql_src_hql_lib_stdlib_js_core_js_seq(rest__Users_seoksoonjang_dev_hql_src_hql_lib_stdlib_js_core_js_rest(args))) ? (() => {
            let coll = first__Users_seoksoonjang_dev_hql_src_hql_lib_stdlib_js_core_js_first(args);
            return __hql_lazy_seq(() => ((s__local_macro_local_203) => s__local_macro_local_203 ? reductions_with_init(f, first__Users_seoksoonjang_dev_hql_src_hql_lib_stdlib_js_core_js_first(s__local_macro_local_203), rest__Users_seoksoonjang_dev_hql_src_hql_lib_stdlib_js_core_js_rest(s__local_macro_local_203)) : null)(seq__Users_seoksoonjang_dev_hql_src_hql_lib_stdlib_js_core_js_seq(coll)));
        })() : reductions_with_init(f, first__Users_seoksoonjang_dev_hql_src_hql_lib_stdlib_js_core_js_first(args), second__Users_seoksoonjang_dev_hql_src_hql_lib_stdlib_stdlib_hql_second(args));
    })();
});
(interpose__Users_seoksoonjang_dev_hql_src_hql_lib_stdlib_stdlib_hql_interpose = function interpose__Users_seoksoonjang_dev_hql_src_hql_lib_stdlib_stdlib_hql_interpose(sep, coll) {
    return (() => {
        let interpose_rest;
        (interpose_rest = (interpose_rest = function interpose_rest(sep, coll) {
            return __hql_lazy_seq(() => ((s__local_macro_local_211) => s__local_macro_local_211 ? cons__Users_seoksoonjang_dev_hql_src_hql_lib_stdlib_js_core_js_cons(sep, cons__Users_seoksoonjang_dev_hql_src_hql_lib_stdlib_js_core_js_cons(first__Users_seoksoonjang_dev_hql_src_hql_lib_stdlib_js_core_js_first(s__local_macro_local_211), interpose_rest(sep, rest__Users_seoksoonjang_dev_hql_src_hql_lib_stdlib_js_core_js_rest(s__local_macro_local_211)))) : null)(seq__Users_seoksoonjang_dev_hql_src_hql_lib_stdlib_js_core_js_seq(coll)));
        }));
        return __hql_lazy_seq(() => ((s__local_macro_local_219) => s__local_macro_local_219 ? cons__Users_seoksoonjang_dev_hql_src_hql_lib_stdlib_js_core_js_cons(first__Users_seoksoonjang_dev_hql_src_hql_lib_stdlib_js_core_js_first(s__local_macro_local_219), interpose_rest(sep, rest__Users_seoksoonjang_dev_hql_src_hql_lib_stdlib_js_core_js_rest(s__local_macro_local_219))) : null)(seq__Users_seoksoonjang_dev_hql_src_hql_lib_stdlib_js_core_js_seq(coll)));
    })();
});
(interleave__Users_seoksoonjang_dev_hql_src_hql_lib_stdlib_stdlib_hql_interleave = function interleave__Users_seoksoonjang_dev_hql_src_hql_lib_stdlib_stdlib_hql_interleave(...colls) {
    return isNil(seq__Users_seoksoonjang_dev_hql_src_hql_lib_stdlib_js_core_js_seq(colls)) ? __hql_lazy_seq(() => null) : isNil(seq__Users_seoksoonjang_dev_hql_src_hql_lib_stdlib_js_core_js_seq(rest__Users_seoksoonjang_dev_hql_src_hql_lib_stdlib_js_core_js_rest(colls))) ? __hql_lazy_seq(() => seq__Users_seoksoonjang_dev_hql_src_hql_lib_stdlib_js_core_js_seq(first__Users_seoksoonjang_dev_hql_src_hql_lib_stdlib_js_core_js_first(colls))) : __hql_lazy_seq(() => (() => {
        let seqs = doall__Users_seoksoonjang_dev_hql_src_hql_lib_stdlib_stdlib_hql_doall(map__Users_seoksoonjang_dev_hql_src_hql_lib_stdlib_stdlib_hql_map(seq__Users_seoksoonjang_dev_hql_src_hql_lib_stdlib_js_core_js_seq, colls));
        return every__Users_seoksoonjang_dev_hql_src_hql_lib_stdlib_stdlib_hql_every(isSome__Users_seoksoonjang_dev_hql_src_hql_lib_stdlib_stdlib_hql_isSome, seqs) ? concat__Users_seoksoonjang_dev_hql_src_hql_lib_stdlib_stdlib_hql_concat(doall__Users_seoksoonjang_dev_hql_src_hql_lib_stdlib_stdlib_hql_doall(map__Users_seoksoonjang_dev_hql_src_hql_lib_stdlib_stdlib_hql_map(first__Users_seoksoonjang_dev_hql_src_hql_lib_stdlib_js_core_js_first, seqs)), apply__Users_seoksoonjang_dev_hql_src_hql_lib_stdlib_stdlib_hql_apply(interleave__Users_seoksoonjang_dev_hql_src_hql_lib_stdlib_stdlib_hql_interleave, doall__Users_seoksoonjang_dev_hql_src_hql_lib_stdlib_stdlib_hql_doall(map__Users_seoksoonjang_dev_hql_src_hql_lib_stdlib_stdlib_hql_map(rest__Users_seoksoonjang_dev_hql_src_hql_lib_stdlib_js_core_js_rest, seqs)))) : null;
    })());
});
(partition__Users_seoksoonjang_dev_hql_src_hql_lib_stdlib_stdlib_hql_partition = function partition__Users_seoksoonjang_dev_hql_src_hql_lib_stdlib_stdlib_hql_partition(n, ...args) {
    try {
        if ((typeof n === "number" ? false : true) || n <= 0) {
            throw TypeError("partition: n must be a positive number");
        }
        else {
            null;
        }
        return (() => {
            let has_step = seq__Users_seoksoonjang_dev_hql_src_hql_lib_stdlib_js_core_js_seq(rest__Users_seoksoonjang_dev_hql_src_hql_lib_stdlib_js_core_js_rest(args));
            let step = has_step ? first__Users_seoksoonjang_dev_hql_src_hql_lib_stdlib_js_core_js_first(args) : n;
            let coll = has_step ? second__Users_seoksoonjang_dev_hql_src_hql_lib_stdlib_stdlib_hql_second(args) : first__Users_seoksoonjang_dev_hql_src_hql_lib_stdlib_js_core_js_first(args);
            if ((typeof step === "number" ? false : true) || step <= 0) {
                ((() => { throw TypeError("partition: step must be a positive number"); })());
            }
            else {
                null;
            }
            return __hql_lazy_seq(() => ((s__local_macro_local_239) => s__local_macro_local_239 ? (() => {
                let p = doall__Users_seoksoonjang_dev_hql_src_hql_lib_stdlib_stdlib_hql_doall(take__Users_seoksoonjang_dev_hql_src_hql_lib_stdlib_stdlib_hql_take(n, s__local_macro_local_239));
                return count__Users_seoksoonjang_dev_hql_src_hql_lib_stdlib_stdlib_hql_count(p) === n ? cons__Users_seoksoonjang_dev_hql_src_hql_lib_stdlib_js_core_js_cons(p, partition__Users_seoksoonjang_dev_hql_src_hql_lib_stdlib_stdlib_hql_partition(n, step, drop__Users_seoksoonjang_dev_hql_src_hql_lib_stdlib_stdlib_hql_drop(step, s__local_macro_local_239))) : null;
            })() : null)(seq__Users_seoksoonjang_dev_hql_src_hql_lib_stdlib_js_core_js_seq(coll)));
        })();
    }
    catch (__hql_ret__) {
        if (__hql_ret__ && __hql_ret__.__hql_early_return__) {
            return __hql_ret__.value;
        }
        else {
            throw __hql_ret__;
        }
    }
});
(partitionAll__Users_seoksoonjang_dev_hql_src_hql_lib_stdlib_stdlib_hql_partitionAll = function partitionAll__Users_seoksoonjang_dev_hql_src_hql_lib_stdlib_stdlib_hql_partitionAll(n, ...args) {
    return (() => {
        let has_step = seq__Users_seoksoonjang_dev_hql_src_hql_lib_stdlib_js_core_js_seq(rest__Users_seoksoonjang_dev_hql_src_hql_lib_stdlib_js_core_js_rest(args));
        let step = has_step ? first__Users_seoksoonjang_dev_hql_src_hql_lib_stdlib_js_core_js_first(args) : n;
        let coll = has_step ? second__Users_seoksoonjang_dev_hql_src_hql_lib_stdlib_stdlib_hql_second(args) : first__Users_seoksoonjang_dev_hql_src_hql_lib_stdlib_js_core_js_first(args);
        return __hql_lazy_seq(() => ((s__local_macro_local_249) => s__local_macro_local_249 ? (() => {
            let p = doall__Users_seoksoonjang_dev_hql_src_hql_lib_stdlib_stdlib_hql_doall(take__Users_seoksoonjang_dev_hql_src_hql_lib_stdlib_stdlib_hql_take(n, s__local_macro_local_249));
            return cons__Users_seoksoonjang_dev_hql_src_hql_lib_stdlib_js_core_js_cons(p, partitionAll__Users_seoksoonjang_dev_hql_src_hql_lib_stdlib_stdlib_hql_partitionAll(n, step, drop__Users_seoksoonjang_dev_hql_src_hql_lib_stdlib_stdlib_hql_drop(step, s__local_macro_local_249)));
        })() : null)(seq__Users_seoksoonjang_dev_hql_src_hql_lib_stdlib_js_core_js_seq(coll)));
    })();
});
(partitionBy__Users_seoksoonjang_dev_hql_src_hql_lib_stdlib_stdlib_hql_partitionBy = function partitionBy__Users_seoksoonjang_dev_hql_src_hql_lib_stdlib_stdlib_hql_partitionBy(f, coll) {
    if (typeof f === "function" ? false : true) {
        throw TypeError("partitionBy: f must be a function");
    }
    else {
        null;
    }
    return __hql_lazy_seq(() => ((s__local_macro_local_261) => s__local_macro_local_261 ? (() => {
        let fst = first__Users_seoksoonjang_dev_hql_src_hql_lib_stdlib_js_core_js_first(s__local_macro_local_261);
        let fv = f(fst);
        let result = ((__init_0, __init_1) => {
            let run = __init_0;
            let remaining = __init_1;
            while (remaining && f(first__Users_seoksoonjang_dev_hql_src_hql_lib_stdlib_js_core_js_first(remaining)) === fv) {
                const __hql_temp_run = conj__Users_seoksoonjang_dev_hql_src_hql_lib_stdlib_stdlib_hql_conj(run, first__Users_seoksoonjang_dev_hql_src_hql_lib_stdlib_js_core_js_first(remaining));
                const __hql_temp_remaining = seq__Users_seoksoonjang_dev_hql_src_hql_lib_stdlib_js_core_js_seq(rest__Users_seoksoonjang_dev_hql_src_hql_lib_stdlib_js_core_js_rest(remaining));
                run = __hql_temp_run;
                remaining = __hql_temp_remaining;
            }
            return [run, remaining];
        })([fst], seq__Users_seoksoonjang_dev_hql_src_hql_lib_stdlib_js_core_js_seq(rest__Users_seoksoonjang_dev_hql_src_hql_lib_stdlib_js_core_js_rest(s__local_macro_local_261)));
        return cons__Users_seoksoonjang_dev_hql_src_hql_lib_stdlib_js_core_js_cons(result["0"], partitionBy__Users_seoksoonjang_dev_hql_src_hql_lib_stdlib_stdlib_hql_partitionBy(f, result["1"]));
    })() : null)(seq__Users_seoksoonjang_dev_hql_src_hql_lib_stdlib_js_core_js_seq(coll)));
});
(isEmpty__Users_seoksoonjang_dev_hql_src_hql_lib_stdlib_stdlib_hql_isEmpty = function isEmpty__Users_seoksoonjang_dev_hql_src_hql_lib_stdlib_stdlib_hql_isEmpty(coll) {
    return isNil(seq__Users_seoksoonjang_dev_hql_src_hql_lib_stdlib_js_core_js_seq(coll));
});
(some__Users_seoksoonjang_dev_hql_src_hql_lib_stdlib_stdlib_hql_some = function some__Users_seoksoonjang_dev_hql_src_hql_lib_stdlib_stdlib_hql_some(pred, coll) {
    if (typeof pred === "function" ? false : true) {
        throw TypeError("some: predicate must be a function, got " + typeof pred);
    }
    else {
        null;
    }
    return ((__init_0) => {
        function loop_7(s) {
            if (s) {
                return (() => {
                    let result = pred(first__Users_seoksoonjang_dev_hql_src_hql_lib_stdlib_js_core_js_first(s));
                    if (result) {
                        return result;
                    }
                    else {
                        return loop_7(seq__Users_seoksoonjang_dev_hql_src_hql_lib_stdlib_js_core_js_seq(rest__Users_seoksoonjang_dev_hql_src_hql_lib_stdlib_js_core_js_rest(s)));
                    }
                })();
            }
            else {
                return null;
            }
        }
        return loop_7(__init_0);
    })(seq__Users_seoksoonjang_dev_hql_src_hql_lib_stdlib_js_core_js_seq(coll));
});
(every__Users_seoksoonjang_dev_hql_src_hql_lib_stdlib_stdlib_hql_every = function every__Users_seoksoonjang_dev_hql_src_hql_lib_stdlib_stdlib_hql_every(pred, coll) {
    if (typeof pred === "function" ? false : true) {
        throw TypeError("every: predicate must be a function, got " + typeof pred);
    }
    else {
        null;
    }
    return ((__init_0) => {
        function loop_8(s) {
            if (s) {
                if (pred(first__Users_seoksoonjang_dev_hql_src_hql_lib_stdlib_js_core_js_first(s))) {
                    return loop_8(seq__Users_seoksoonjang_dev_hql_src_hql_lib_stdlib_js_core_js_seq(rest__Users_seoksoonjang_dev_hql_src_hql_lib_stdlib_js_core_js_rest(s)));
                }
                else {
                    return false;
                }
            }
            else {
                return true;
            }
        }
        return loop_8(__init_0);
    })(seq__Users_seoksoonjang_dev_hql_src_hql_lib_stdlib_js_core_js_seq(coll));
});
(notAny__Users_seoksoonjang_dev_hql_src_hql_lib_stdlib_stdlib_hql_notAny = function notAny__Users_seoksoonjang_dev_hql_src_hql_lib_stdlib_stdlib_hql_notAny(pred, coll) {
    if (typeof pred === "function" ? false : true) {
        throw TypeError("notAny: predicate must be a function, got " + typeof pred);
    }
    else {
        null;
    }
    return ((__init_0) => {
        function loop_9(s) {
            if (s) {
                if (pred(first__Users_seoksoonjang_dev_hql_src_hql_lib_stdlib_js_core_js_first(s))) {
                    return false;
                }
                else {
                    return loop_9(seq__Users_seoksoonjang_dev_hql_src_hql_lib_stdlib_js_core_js_seq(rest__Users_seoksoonjang_dev_hql_src_hql_lib_stdlib_js_core_js_rest(s)));
                }
            }
            else {
                return true;
            }
        }
        return loop_9(__init_0);
    })(seq__Users_seoksoonjang_dev_hql_src_hql_lib_stdlib_js_core_js_seq(coll));
});
(notEvery__Users_seoksoonjang_dev_hql_src_hql_lib_stdlib_stdlib_hql_notEvery = function notEvery__Users_seoksoonjang_dev_hql_src_hql_lib_stdlib_stdlib_hql_notEvery(pred, coll) {
    if (typeof pred === "function" ? false : true) {
        throw TypeError("notEvery: predicate must be a function, got " + typeof pred);
    }
    else {
        null;
    }
    return ((__init_0) => {
        function loop_10(s) {
            if (s) {
                if (pred(first__Users_seoksoonjang_dev_hql_src_hql_lib_stdlib_js_core_js_first(s))) {
                    return loop_10(seq__Users_seoksoonjang_dev_hql_src_hql_lib_stdlib_js_core_js_seq(rest__Users_seoksoonjang_dev_hql_src_hql_lib_stdlib_js_core_js_rest(s)));
                }
                else {
                    return true;
                }
            }
            else {
                return false;
            }
        }
        return loop_10(__init_0);
    })(seq__Users_seoksoonjang_dev_hql_src_hql_lib_stdlib_js_core_js_seq(coll));
});
(isSome__Users_seoksoonjang_dev_hql_src_hql_lib_stdlib_stdlib_hql_isSome = function isSome__Users_seoksoonjang_dev_hql_src_hql_lib_stdlib_stdlib_hql_isSome(x) {
    return isNil(x) ? false : true;
});
(isNil__Users_seoksoonjang_dev_hql_src_hql_lib_stdlib_stdlib_hql_isNil = function isNil__Users_seoksoonjang_dev_hql_src_hql_lib_stdlib_stdlib_hql_isNil(x) {
    return x == null;
});
(isEven__Users_seoksoonjang_dev_hql_src_hql_lib_stdlib_stdlib_hql_isEven = function isEven__Users_seoksoonjang_dev_hql_src_hql_lib_stdlib_stdlib_hql_isEven(n) {
    return 0 == mod__Users_seoksoonjang_dev_hql_src_hql_lib_stdlib_stdlib_hql_mod(n, 2);
});
(isOdd__Users_seoksoonjang_dev_hql_src_hql_lib_stdlib_stdlib_hql_isOdd = function isOdd__Users_seoksoonjang_dev_hql_src_hql_lib_stdlib_stdlib_hql_isOdd(n) {
    return 0 == mod__Users_seoksoonjang_dev_hql_src_hql_lib_stdlib_stdlib_hql_mod(n, 2) ? false : true;
});
(isZero__Users_seoksoonjang_dev_hql_src_hql_lib_stdlib_stdlib_hql_isZero = function isZero__Users_seoksoonjang_dev_hql_src_hql_lib_stdlib_stdlib_hql_isZero(n) {
    return n == 0;
});
(isPositive__Users_seoksoonjang_dev_hql_src_hql_lib_stdlib_stdlib_hql_isPositive = function isPositive__Users_seoksoonjang_dev_hql_src_hql_lib_stdlib_stdlib_hql_isPositive(n) {
    return n > 0;
});
(isNegative__Users_seoksoonjang_dev_hql_src_hql_lib_stdlib_stdlib_hql_isNegative = function isNegative__Users_seoksoonjang_dev_hql_src_hql_lib_stdlib_stdlib_hql_isNegative(n) {
    return n < 0;
});
(isNumber__Users_seoksoonjang_dev_hql_src_hql_lib_stdlib_stdlib_hql_isNumber = function isNumber__Users_seoksoonjang_dev_hql_src_hql_lib_stdlib_stdlib_hql_isNumber(x) {
    return "number" == typeof x;
});
(isString__Users_seoksoonjang_dev_hql_src_hql_lib_stdlib_stdlib_hql_isString = function isString__Users_seoksoonjang_dev_hql_src_hql_lib_stdlib_stdlib_hql_isString(x) {
    return "string" == typeof x;
});
(isBoolean__Users_seoksoonjang_dev_hql_src_hql_lib_stdlib_stdlib_hql_isBoolean = function isBoolean__Users_seoksoonjang_dev_hql_src_hql_lib_stdlib_stdlib_hql_isBoolean(x) {
    return "boolean" == typeof x;
});
(isFunction__Users_seoksoonjang_dev_hql_src_hql_lib_stdlib_stdlib_hql_isFunction = function isFunction__Users_seoksoonjang_dev_hql_src_hql_lib_stdlib_stdlib_hql_isFunction(x) {
    return "function" == typeof x;
});
(isArray__Users_seoksoonjang_dev_hql_src_hql_lib_stdlib_stdlib_hql_isArray = function isArray__Users_seoksoonjang_dev_hql_src_hql_lib_stdlib_stdlib_hql_isArray(x) {
    return Array.isArray(x);
});
(isObject__Users_seoksoonjang_dev_hql_src_hql_lib_stdlib_stdlib_hql_isObject = function isObject__Users_seoksoonjang_dev_hql_src_hql_lib_stdlib_stdlib_hql_isObject(x) {
    return (isNil(x) ? false : true) && (typeof x === "object" && (Array.isArray(x) ? false : true));
});
(isDelay__Users_seoksoonjang_dev_hql_src_hql_lib_stdlib_stdlib_hql_isDelay = function isDelay__Users_seoksoonjang_dev_hql_src_hql_lib_stdlib_stdlib_hql_isDelay(x) {
    return x instanceof Delay__Users_seoksoonjang_dev_hql_src_hql_lib_stdlib_js_internal_seq_protocol_js_Delay;
});
(force__Users_seoksoonjang_dev_hql_src_hql_lib_stdlib_stdlib_hql_force = function force__Users_seoksoonjang_dev_hql_src_hql_lib_stdlib_stdlib_hql_force(x) {
    return x instanceof Delay__Users_seoksoonjang_dev_hql_src_hql_lib_stdlib_js_internal_seq_protocol_js_Delay ? x.deref() : x;
});
(realized__Users_seoksoonjang_dev_hql_src_hql_lib_stdlib_stdlib_hql_realized = function realized__Users_seoksoonjang_dev_hql_src_hql_lib_stdlib_stdlib_hql_realized(coll) {
    return isNil(coll) ? true : coll instanceof Delay__Users_seoksoonjang_dev_hql_src_hql_lib_stdlib_js_internal_seq_protocol_js_Delay ? coll._realized : coll instanceof LazySeq__Users_seoksoonjang_dev_hql_src_hql_lib_stdlib_js_internal_seq_protocol_js_LazySeq ? coll._isRealized : true;
});
(inc__Users_seoksoonjang_dev_hql_src_hql_lib_stdlib_stdlib_hql_inc = function inc__Users_seoksoonjang_dev_hql_src_hql_lib_stdlib_stdlib_hql_inc(x) {
    return x + 1;
});
(dec__Users_seoksoonjang_dev_hql_src_hql_lib_stdlib_stdlib_hql_dec = function dec__Users_seoksoonjang_dev_hql_src_hql_lib_stdlib_stdlib_hql_dec(x) {
    return x - 1;
});
(abs__Users_seoksoonjang_dev_hql_src_hql_lib_stdlib_stdlib_hql_abs = function abs__Users_seoksoonjang_dev_hql_src_hql_lib_stdlib_stdlib_hql_abs(x) {
    return Math.abs(x);
});
(add__Users_seoksoonjang_dev_hql_src_hql_lib_stdlib_stdlib_hql_add = function add__Users_seoksoonjang_dev_hql_src_hql_lib_stdlib_stdlib_hql_add(...nums) {
    return reduce__Users_seoksoonjang_dev_hql_src_hql_lib_stdlib_stdlib_hql_reduce((a, b) => a + b, 0, nums);
});
(sub__Users_seoksoonjang_dev_hql_src_hql_lib_stdlib_stdlib_hql_sub = function sub__Users_seoksoonjang_dev_hql_src_hql_lib_stdlib_stdlib_hql_sub(...nums) {
    return isNil(seq__Users_seoksoonjang_dev_hql_src_hql_lib_stdlib_js_core_js_seq(nums)) ? 0 : isNil(seq__Users_seoksoonjang_dev_hql_src_hql_lib_stdlib_js_core_js_seq(rest__Users_seoksoonjang_dev_hql_src_hql_lib_stdlib_js_core_js_rest(nums))) ? 0 - first__Users_seoksoonjang_dev_hql_src_hql_lib_stdlib_js_core_js_first(nums) : reduce__Users_seoksoonjang_dev_hql_src_hql_lib_stdlib_stdlib_hql_reduce((a, b) => a - b, first__Users_seoksoonjang_dev_hql_src_hql_lib_stdlib_js_core_js_first(nums), rest__Users_seoksoonjang_dev_hql_src_hql_lib_stdlib_js_core_js_rest(nums));
});
(mul__Users_seoksoonjang_dev_hql_src_hql_lib_stdlib_stdlib_hql_mul = function mul__Users_seoksoonjang_dev_hql_src_hql_lib_stdlib_stdlib_hql_mul(...nums) {
    return reduce__Users_seoksoonjang_dev_hql_src_hql_lib_stdlib_stdlib_hql_reduce((a, b) => a * b, 1, nums);
});
(div__Users_seoksoonjang_dev_hql_src_hql_lib_stdlib_stdlib_hql_div = function div__Users_seoksoonjang_dev_hql_src_hql_lib_stdlib_stdlib_hql_div(...nums) {
    return isNil(seq__Users_seoksoonjang_dev_hql_src_hql_lib_stdlib_js_core_js_seq(nums)) ? 1 : isNil(seq__Users_seoksoonjang_dev_hql_src_hql_lib_stdlib_js_core_js_seq(rest__Users_seoksoonjang_dev_hql_src_hql_lib_stdlib_js_core_js_rest(nums))) ? 1 / first__Users_seoksoonjang_dev_hql_src_hql_lib_stdlib_js_core_js_first(nums) : reduce__Users_seoksoonjang_dev_hql_src_hql_lib_stdlib_stdlib_hql_reduce((a, b) => a / b, first__Users_seoksoonjang_dev_hql_src_hql_lib_stdlib_js_core_js_first(nums), rest__Users_seoksoonjang_dev_hql_src_hql_lib_stdlib_js_core_js_rest(nums));
});
(mod__Users_seoksoonjang_dev_hql_src_hql_lib_stdlib_stdlib_hql_mod = function mod__Users_seoksoonjang_dev_hql_src_hql_lib_stdlib_stdlib_hql_mod(a, b) {
    return a % b;
});
(eq__Users_seoksoonjang_dev_hql_src_hql_lib_stdlib_stdlib_hql_eq = function eq__Users_seoksoonjang_dev_hql_src_hql_lib_stdlib_stdlib_hql_eq(...vals) {
    return (seq__Users_seoksoonjang_dev_hql_src_hql_lib_stdlib_js_core_js_seq(rest__Users_seoksoonjang_dev_hql_src_hql_lib_stdlib_js_core_js_rest(vals)) ? false : true) ? true : (() => {
        let fst = first__Users_seoksoonjang_dev_hql_src_hql_lib_stdlib_js_core_js_first(vals);
        return ((__init_0) => {
            function loop_11(s) {
                if (s) {
                    if (fst === first__Users_seoksoonjang_dev_hql_src_hql_lib_stdlib_js_core_js_first(s)) {
                        return loop_11(seq__Users_seoksoonjang_dev_hql_src_hql_lib_stdlib_js_core_js_seq(rest__Users_seoksoonjang_dev_hql_src_hql_lib_stdlib_js_core_js_rest(s)));
                    }
                    else {
                        return false;
                    }
                }
                else {
                    return true;
                }
            }
            return loop_11(__init_0);
        })(seq__Users_seoksoonjang_dev_hql_src_hql_lib_stdlib_js_core_js_seq(rest__Users_seoksoonjang_dev_hql_src_hql_lib_stdlib_js_core_js_rest(vals)));
    })();
});
(neq__Users_seoksoonjang_dev_hql_src_hql_lib_stdlib_stdlib_hql_neq = function neq__Users_seoksoonjang_dev_hql_src_hql_lib_stdlib_stdlib_hql_neq(a, b) {
    return a === b ? false : true;
});
(deepEqInternal__Users_seoksoonjang_dev_hql_src_hql_lib_stdlib_stdlib_hql_deepEqInternal = function deepEqInternal__Users_seoksoonjang_dev_hql_src_hql_lib_stdlib_stdlib_hql_deepEqInternal(a, b, seenAB, seenBA) {
    return a === b ? true : isNil(a) || isNil(b) ? false : (typeof a === "object" ? false : true) || (typeof b === "object" ? false : true) ? false : (() => {
        let mappedB = seenAB.get(a);
        let mappedA = seenBA.get(b);
        return (isNil(mappedB) ? false : true) && (mappedB === b ? false : true) || (isNil(mappedA) ? false : true) && (mappedA === a ? false : true) ? false : (isNil(mappedB) ? false : true) && mappedB === b || (isNil(mappedA) ? false : true) && mappedA === a ? true : (() => {
            let _seenAB = seenAB.set(a, b);
            let _seenBA = seenBA.set(b, a);
            return Array.isArray(a) && Array.isArray(b) ? (a.length === b.length ? false : true) ? false : ((__init_0) => {
                function loop_12(i) {
                    if (i >= a.length) {
                        return true;
                    }
                    else if (deepEqInternal__Users_seoksoonjang_dev_hql_src_hql_lib_stdlib_stdlib_hql_deepEqInternal(a[i], b[i], seenAB, seenBA)) {
                        return loop_12(i + 1);
                    }
                    else {
                        return false;
                    }
                }
                return loop_12(__init_0);
            })(0) : a instanceof Map && b instanceof Map ? (a.size === b.size ? false : true) ? false : (() => {
                let keys_a = Array.from(a.keys());
                return ((__init_0) => {
                    function loop_13(i) {
                        if (i >= keys_a.length) {
                            return true;
                        }
                        else {
                            return (() => {
                                let k = keys_a[i];
                                if (b.has(k) && deepEqInternal__Users_seoksoonjang_dev_hql_src_hql_lib_stdlib_stdlib_hql_deepEqInternal(a.get(k), b.get(k), seenAB, seenBA)) {
                                    return loop_13(i + 1);
                                }
                                else {
                                    return false;
                                }
                            })();
                        }
                    }
                    return loop_13(__init_0);
                })(0);
            })() : a instanceof Set && b instanceof Set ? (a.size === b.size ? false : true) ? false : (() => {
                let arr_a = Array.from(a);
                return ((__init_0) => {
                    function loop_14(i) {
                        if (i >= arr_a.length) {
                            return true;
                        }
                        else if (b.has(arr_a[i])) {
                            return loop_14(i + 1);
                        }
                        else {
                            return false;
                        }
                    }
                    return loop_14(__init_0);
                })(0);
            })() : typeof a === "object" && a !== null && !Array.isArray(a) && (typeof b === "object" && b !== null && !Array.isArray(b)) ? (() => {
                let keys_a = Object.keys(a);
                let keys_b = Object.keys(b);
                return (keys_a.length === keys_b.length ? false : true) ? false : ((__init_0) => {
                    function loop_15(i) {
                        if (i >= keys_a.length) {
                            return true;
                        }
                        else {
                            return (() => {
                                let k = keys_a[i];
                                if (k in b && deepEqInternal__Users_seoksoonjang_dev_hql_src_hql_lib_stdlib_stdlib_hql_deepEqInternal(a[k], b[k], seenAB, seenBA)) {
                                    return loop_15(i + 1);
                                }
                                else {
                                    return false;
                                }
                            })();
                        }
                    }
                    return loop_15(__init_0);
                })(0);
            })() : false;
        })();
    })();
});
(deepEq__Users_seoksoonjang_dev_hql_src_hql_lib_stdlib_stdlib_hql_deepEq = function deepEq__Users_seoksoonjang_dev_hql_src_hql_lib_stdlib_stdlib_hql_deepEq(a, b) {
    return deepEqInternal__Users_seoksoonjang_dev_hql_src_hql_lib_stdlib_stdlib_hql_deepEqInternal(a, b, new WeakMap(), new WeakMap());
});
(lt__Users_seoksoonjang_dev_hql_src_hql_lib_stdlib_stdlib_hql_lt = function lt__Users_seoksoonjang_dev_hql_src_hql_lib_stdlib_stdlib_hql_lt(...nums) {
    return ((__init_0) => {
        function loop_16(s) {
            if (s && seq__Users_seoksoonjang_dev_hql_src_hql_lib_stdlib_js_core_js_seq(rest__Users_seoksoonjang_dev_hql_src_hql_lib_stdlib_js_core_js_rest(s))) {
                if (first__Users_seoksoonjang_dev_hql_src_hql_lib_stdlib_js_core_js_first(s) < first__Users_seoksoonjang_dev_hql_src_hql_lib_stdlib_js_core_js_first(rest__Users_seoksoonjang_dev_hql_src_hql_lib_stdlib_js_core_js_rest(s))) {
                    return loop_16(seq__Users_seoksoonjang_dev_hql_src_hql_lib_stdlib_js_core_js_seq(rest__Users_seoksoonjang_dev_hql_src_hql_lib_stdlib_js_core_js_rest(s)));
                }
                else {
                    return false;
                }
            }
            else {
                return true;
            }
        }
        return loop_16(__init_0);
    })(seq__Users_seoksoonjang_dev_hql_src_hql_lib_stdlib_js_core_js_seq(nums));
});
(gt__Users_seoksoonjang_dev_hql_src_hql_lib_stdlib_stdlib_hql_gt = function gt__Users_seoksoonjang_dev_hql_src_hql_lib_stdlib_stdlib_hql_gt(...nums) {
    return ((__init_0) => {
        function loop_17(s) {
            if (s && seq__Users_seoksoonjang_dev_hql_src_hql_lib_stdlib_js_core_js_seq(rest__Users_seoksoonjang_dev_hql_src_hql_lib_stdlib_js_core_js_rest(s))) {
                if (first__Users_seoksoonjang_dev_hql_src_hql_lib_stdlib_js_core_js_first(s) > first__Users_seoksoonjang_dev_hql_src_hql_lib_stdlib_js_core_js_first(rest__Users_seoksoonjang_dev_hql_src_hql_lib_stdlib_js_core_js_rest(s))) {
                    return loop_17(seq__Users_seoksoonjang_dev_hql_src_hql_lib_stdlib_js_core_js_seq(rest__Users_seoksoonjang_dev_hql_src_hql_lib_stdlib_js_core_js_rest(s)));
                }
                else {
                    return false;
                }
            }
            else {
                return true;
            }
        }
        return loop_17(__init_0);
    })(seq__Users_seoksoonjang_dev_hql_src_hql_lib_stdlib_js_core_js_seq(nums));
});
(lte__Users_seoksoonjang_dev_hql_src_hql_lib_stdlib_stdlib_hql_lte = function lte__Users_seoksoonjang_dev_hql_src_hql_lib_stdlib_stdlib_hql_lte(...nums) {
    return ((__init_0) => {
        function loop_18(s) {
            if (s && seq__Users_seoksoonjang_dev_hql_src_hql_lib_stdlib_js_core_js_seq(rest__Users_seoksoonjang_dev_hql_src_hql_lib_stdlib_js_core_js_rest(s))) {
                if (first__Users_seoksoonjang_dev_hql_src_hql_lib_stdlib_js_core_js_first(s) <= first__Users_seoksoonjang_dev_hql_src_hql_lib_stdlib_js_core_js_first(rest__Users_seoksoonjang_dev_hql_src_hql_lib_stdlib_js_core_js_rest(s))) {
                    return loop_18(seq__Users_seoksoonjang_dev_hql_src_hql_lib_stdlib_js_core_js_seq(rest__Users_seoksoonjang_dev_hql_src_hql_lib_stdlib_js_core_js_rest(s)));
                }
                else {
                    return false;
                }
            }
            else {
                return true;
            }
        }
        return loop_18(__init_0);
    })(seq__Users_seoksoonjang_dev_hql_src_hql_lib_stdlib_js_core_js_seq(nums));
});
(gte__Users_seoksoonjang_dev_hql_src_hql_lib_stdlib_stdlib_hql_gte = function gte__Users_seoksoonjang_dev_hql_src_hql_lib_stdlib_stdlib_hql_gte(...nums) {
    return ((__init_0) => {
        function loop_19(s) {
            if (s && seq__Users_seoksoonjang_dev_hql_src_hql_lib_stdlib_js_core_js_seq(rest__Users_seoksoonjang_dev_hql_src_hql_lib_stdlib_js_core_js_rest(s))) {
                if (first__Users_seoksoonjang_dev_hql_src_hql_lib_stdlib_js_core_js_first(s) >= first__Users_seoksoonjang_dev_hql_src_hql_lib_stdlib_js_core_js_first(rest__Users_seoksoonjang_dev_hql_src_hql_lib_stdlib_js_core_js_rest(s))) {
                    return loop_19(seq__Users_seoksoonjang_dev_hql_src_hql_lib_stdlib_js_core_js_seq(rest__Users_seoksoonjang_dev_hql_src_hql_lib_stdlib_js_core_js_rest(s)));
                }
                else {
                    return false;
                }
            }
            else {
                return true;
            }
        }
        return loop_19(__init_0);
    })(seq__Users_seoksoonjang_dev_hql_src_hql_lib_stdlib_js_core_js_seq(nums));
});
(symbol__Users_seoksoonjang_dev_hql_src_hql_lib_stdlib_stdlib_hql_symbol = function symbol__Users_seoksoonjang_dev_hql_src_hql_lib_stdlib_stdlib_hql_symbol(n) {
    return __hql_hash_map("type", "symbol", "name", String(n));
});
(keyword__Users_seoksoonjang_dev_hql_src_hql_lib_stdlib_stdlib_hql_keyword = function keyword__Users_seoksoonjang_dev_hql_src_hql_lib_stdlib_stdlib_hql_keyword(n) {
    return (() => {
        let s = String(n);
        return s.startsWith(":") ? s : ":" + s;
    })();
});
(name__Users_seoksoonjang_dev_hql_src_hql_lib_stdlib_stdlib_hql_name = function name__Users_seoksoonjang_dev_hql_src_hql_lib_stdlib_stdlib_hql_name(x) {
    return isNil(x) ? null : typeof x === "object" && x.type === "symbol" ? x.name : (() => {
        let s = String(x);
        return s.startsWith(":") ? s.slice(1) : s;
    })();
});
(repeat__Users_seoksoonjang_dev_hql_src_hql_lib_stdlib_stdlib_hql_repeat = function repeat__Users_seoksoonjang_dev_hql_src_hql_lib_stdlib_stdlib_hql_repeat(x) {
    return map__Users_seoksoonjang_dev_hql_src_hql_lib_stdlib_stdlib_hql_map((_) => x, range__Users_seoksoonjang_dev_hql_src_hql_lib_stdlib_js_core_js_range());
});
(repeatedly__Users_seoksoonjang_dev_hql_src_hql_lib_stdlib_stdlib_hql_repeatedly = function repeatedly__Users_seoksoonjang_dev_hql_src_hql_lib_stdlib_stdlib_hql_repeatedly(f) {
    if (typeof f === "function" ? false : true) {
        throw TypeError("repeatedly: f must be a function");
    }
    else {
        null;
    }
    return __hql_lazy_seq(() => cons__Users_seoksoonjang_dev_hql_src_hql_lib_stdlib_js_core_js_cons(f(), repeatedly__Users_seoksoonjang_dev_hql_src_hql_lib_stdlib_stdlib_hql_repeatedly(f)));
});
(cycle__Users_seoksoonjang_dev_hql_src_hql_lib_stdlib_stdlib_hql_cycle = function cycle__Users_seoksoonjang_dev_hql_src_hql_lib_stdlib_stdlib_hql_cycle(coll) {
    return (() => {
        let xs = seq__Users_seoksoonjang_dev_hql_src_hql_lib_stdlib_js_core_js_seq(coll);
        return xs ? (() => {
            let step = (s) => __hql_lazy_seq(() => seq__Users_seoksoonjang_dev_hql_src_hql_lib_stdlib_js_core_js_seq(s) ? cons__Users_seoksoonjang_dev_hql_src_hql_lib_stdlib_js_core_js_cons(first__Users_seoksoonjang_dev_hql_src_hql_lib_stdlib_js_core_js_first(s), step(rest__Users_seoksoonjang_dev_hql_src_hql_lib_stdlib_js_core_js_rest(s))) : step(xs));
            return step(xs);
        })() : null;
    })();
});
(iterate__Users_seoksoonjang_dev_hql_src_hql_lib_stdlib_stdlib_hql_iterate = function iterate__Users_seoksoonjang_dev_hql_src_hql_lib_stdlib_stdlib_hql_iterate(f, x) {
    if (typeof f === "function" ? false : true) {
        throw TypeError("iterate: iterator function must be a function");
    }
    else {
        null;
    }
    return __hql_lazy_seq(() => cons__Users_seoksoonjang_dev_hql_src_hql_lib_stdlib_js_core_js_cons(x, iterate__Users_seoksoonjang_dev_hql_src_hql_lib_stdlib_stdlib_hql_iterate(f, f(x))));
});
(keys__Users_seoksoonjang_dev_hql_src_hql_lib_stdlib_stdlib_hql_keys = function keys__Users_seoksoonjang_dev_hql_src_hql_lib_stdlib_stdlib_hql_keys(obj) {
    return isNil(obj) ? [] : Object.keys(obj);
});
(groupBy__Users_seoksoonjang_dev_hql_src_hql_lib_stdlib_stdlib_hql_groupBy = function groupBy__Users_seoksoonjang_dev_hql_src_hql_lib_stdlib_stdlib_hql_groupBy(f, coll) {
    if (typeof f === "function" ? false : true) {
        throw TypeError("groupBy: key function must be a function, got " + typeof f);
    }
    else {
        null;
    }
    return isNil(coll) ? new Map() : (() => {
        let result = new Map();
        return ((__init_0) => {
            function loop_20(s) {
                if (s) {
                    return (() => {
                        let item = first__Users_seoksoonjang_dev_hql_src_hql_lib_stdlib_js_core_js_first(s);
                        let key = f(item);
                        result.has(key) ? result.get(key).push(item) : result.set(key, [item]);
                        return loop_20(seq__Users_seoksoonjang_dev_hql_src_hql_lib_stdlib_js_core_js_seq(rest__Users_seoksoonjang_dev_hql_src_hql_lib_stdlib_js_core_js_rest(s)));
                    })();
                }
                else {
                    return result;
                }
            }
            return loop_20(__init_0);
        })(seq__Users_seoksoonjang_dev_hql_src_hql_lib_stdlib_js_core_js_seq(coll));
    })();
});
(reverse__Users_seoksoonjang_dev_hql_src_hql_lib_stdlib_stdlib_hql_reverse = function reverse__Users_seoksoonjang_dev_hql_src_hql_lib_stdlib_stdlib_hql_reverse(coll) {
    return isNil(coll) ? [] : Array.from(coll).reverse();
});
(identity__Users_seoksoonjang_dev_hql_src_hql_lib_stdlib_stdlib_hql_identity = function identity__Users_seoksoonjang_dev_hql_src_hql_lib_stdlib_stdlib_hql_identity(x) {
    return x;
});
(constantly__Users_seoksoonjang_dev_hql_src_hql_lib_stdlib_stdlib_hql_constantly = function constantly__Users_seoksoonjang_dev_hql_src_hql_lib_stdlib_stdlib_hql_constantly(x) {
    return (..._) => x;
});
(vals__Users_seoksoonjang_dev_hql_src_hql_lib_stdlib_stdlib_hql_vals = function vals__Users_seoksoonjang_dev_hql_src_hql_lib_stdlib_stdlib_hql_vals(m) {
    return isNil(m) ? [] : Object.values(m);
});
(juxt__Users_seoksoonjang_dev_hql_src_hql_lib_stdlib_stdlib_hql_juxt = function juxt__Users_seoksoonjang_dev_hql_src_hql_lib_stdlib_stdlib_hql_juxt(...fns) {
    return (...args) => map__Users_seoksoonjang_dev_hql_src_hql_lib_stdlib_stdlib_hql_map((f) => apply__Users_seoksoonjang_dev_hql_src_hql_lib_stdlib_stdlib_hql_apply(f, args), fns);
});
(zipmap__Users_seoksoonjang_dev_hql_src_hql_lib_stdlib_stdlib_hql_zipmap = function zipmap__Users_seoksoonjang_dev_hql_src_hql_lib_stdlib_stdlib_hql_zipmap(ks, vs) {
    return ((__init_0, __init_1, __init_2) => {
        let keys = __init_0;
        let values = __init_1;
        let result = __init_2;
        while (keys && values) {
            const __hql_temp_keys = next__Users_seoksoonjang_dev_hql_src_hql_lib_stdlib_stdlib_hql_next(keys);
            const __hql_temp_values = next__Users_seoksoonjang_dev_hql_src_hql_lib_stdlib_stdlib_hql_next(values);
            const __hql_temp_result = assoc__Users_seoksoonjang_dev_hql_src_hql_lib_stdlib_stdlib_hql_assoc(result, first__Users_seoksoonjang_dev_hql_src_hql_lib_stdlib_js_core_js_first(keys), first__Users_seoksoonjang_dev_hql_src_hql_lib_stdlib_js_core_js_first(values));
            keys = __hql_temp_keys;
            values = __hql_temp_values;
            result = __hql_temp_result;
        }
        return result;
    })(seq__Users_seoksoonjang_dev_hql_src_hql_lib_stdlib_js_core_js_seq(ks), seq__Users_seoksoonjang_dev_hql_src_hql_lib_stdlib_js_core_js_seq(vs), __hql_hash_map());
});
(get__Users_seoksoonjang_dev_hql_src_hql_lib_stdlib_stdlib_hql_get = function get__Users_seoksoonjang_dev_hql_src_hql_lib_stdlib_stdlib_hql_get(m, key, ...args) {
    return (() => {
        let not_found = first__Users_seoksoonjang_dev_hql_src_hql_lib_stdlib_js_core_js_first(args);
        return isNil(m) ? not_found : m instanceof Map ? m.has(key) ? m.get(key) : not_found : key in m ? m[key] : not_found;
    })();
});
(getIn__Users_seoksoonjang_dev_hql_src_hql_lib_stdlib_stdlib_hql_getIn = function getIn__Users_seoksoonjang_dev_hql_src_hql_lib_stdlib_stdlib_hql_getIn(m, path, ...args) {
    return (() => {
        let not_found = first__Users_seoksoonjang_dev_hql_src_hql_lib_stdlib_js_core_js_first(args);
        let sentinel = __hql_hash_map();
        return path.length === 0 ? m : ((__init_0, __init_1) => {
            function loop_22(current, s) {
                if (s) {
                    return (() => {
                        let next_val = get__Users_seoksoonjang_dev_hql_src_hql_lib_stdlib_stdlib_hql_get(current, first__Users_seoksoonjang_dev_hql_src_hql_lib_stdlib_js_core_js_first(s), sentinel);
                        if (next_val === sentinel) {
                            return not_found;
                        }
                        else {
                            return loop_22(next_val, seq__Users_seoksoonjang_dev_hql_src_hql_lib_stdlib_js_core_js_seq(rest__Users_seoksoonjang_dev_hql_src_hql_lib_stdlib_js_core_js_rest(s)));
                        }
                    })();
                }
                else {
                    return current;
                }
            }
            return loop_22(__init_0, __init_1);
        })(m, seq__Users_seoksoonjang_dev_hql_src_hql_lib_stdlib_js_core_js_seq(path));
    })();
});
(assoc__Users_seoksoonjang_dev_hql_src_hql_lib_stdlib_stdlib_hql_assoc = function assoc__Users_seoksoonjang_dev_hql_src_hql_lib_stdlib_stdlib_hql_assoc(m, key, value) {
    return isNil(m) ? (() => {
        let r = __hql_hash_map();
        r[key] = value;
        return r;
    })() : m instanceof Map ? (() => {
        let r = new Map(m);
        r.set(key, value);
        return r;
    })() : Array.isArray(m) ? (() => {
        let r = [...m];
        r[key] = value;
        return r;
    })() : (() => {
        let r = { ...m };
        r[key] = value;
        return r;
    })();
});
(assocIn__Users_seoksoonjang_dev_hql_src_hql_lib_stdlib_stdlib_hql_assocIn = function assocIn__Users_seoksoonjang_dev_hql_src_hql_lib_stdlib_stdlib_hql_assocIn(m, path, value) {
    return path.length === 0 ? value : path.length === 1 ? assoc__Users_seoksoonjang_dev_hql_src_hql_lib_stdlib_stdlib_hql_assoc(m, path["0"], value) : (() => {
        let key = path["0"];
        let rest_path = path.slice(1);
        let base = isNil(m) ? __hql_hash_map() : m;
        let existing = get__Users_seoksoonjang_dev_hql_src_hql_lib_stdlib_stdlib_hql_get(base, key);
        return assoc__Users_seoksoonjang_dev_hql_src_hql_lib_stdlib_stdlib_hql_assoc(base, key, assocIn__Users_seoksoonjang_dev_hql_src_hql_lib_stdlib_stdlib_hql_assocIn((isNil(existing) ? false : true) && typeof existing === "object" ? existing : typeof rest_path["0"] === "number" ? [] : __hql_hash_map(), rest_path, value));
    })();
});
(dissoc__Users_seoksoonjang_dev_hql_src_hql_lib_stdlib_stdlib_hql_dissoc = function dissoc__Users_seoksoonjang_dev_hql_src_hql_lib_stdlib_stdlib_hql_dissoc(m, ...ks) {
    return isNil(m) ? __hql_hash_map() : m instanceof Map ? (() => {
        let r = new Map(m);
        return reduce__Users_seoksoonjang_dev_hql_src_hql_lib_stdlib_stdlib_hql_reduce((acc, k) => {
            acc.delete(k);
            return acc;
        }, r, ks);
    })() : Array.isArray(m) ? (() => {
        let r = Array.from(m);
        return reduce__Users_seoksoonjang_dev_hql_src_hql_lib_stdlib_stdlib_hql_reduce((acc, k) => {
            delete acc[k];
            return acc;
        }, r, ks);
    })() : (() => {
        let r = { ...m };
        return reduce__Users_seoksoonjang_dev_hql_src_hql_lib_stdlib_stdlib_hql_reduce((acc, k) => {
            delete acc[k];
            return acc;
        }, r, ks);
    })();
});
(update__Users_seoksoonjang_dev_hql_src_hql_lib_stdlib_stdlib_hql_update = function update__Users_seoksoonjang_dev_hql_src_hql_lib_stdlib_stdlib_hql_update(m, key, f) {
    return assoc__Users_seoksoonjang_dev_hql_src_hql_lib_stdlib_stdlib_hql_assoc(m, key, f(get__Users_seoksoonjang_dev_hql_src_hql_lib_stdlib_stdlib_hql_get(m, key)));
});
(updateIn__Users_seoksoonjang_dev_hql_src_hql_lib_stdlib_stdlib_hql_updateIn = function updateIn__Users_seoksoonjang_dev_hql_src_hql_lib_stdlib_stdlib_hql_updateIn(m, path, f) {
    return path.length === 0 ? f(m) : assocIn__Users_seoksoonjang_dev_hql_src_hql_lib_stdlib_stdlib_hql_assocIn(m, path, f(getIn__Users_seoksoonjang_dev_hql_src_hql_lib_stdlib_stdlib_hql_getIn(m, path)));
});
(merge__Users_seoksoonjang_dev_hql_src_hql_lib_stdlib_stdlib_hql_merge = function merge__Users_seoksoonjang_dev_hql_src_hql_lib_stdlib_stdlib_hql_merge(...maps) {
    return (() => {
        let non_nil = filter__Users_seoksoonjang_dev_hql_src_hql_lib_stdlib_stdlib_hql_filter((m) => isNil(m) ? false : true, maps);
        return isEmpty__Users_seoksoonjang_dev_hql_src_hql_lib_stdlib_stdlib_hql_isEmpty(non_nil) ? __hql_hash_map() : first__Users_seoksoonjang_dev_hql_src_hql_lib_stdlib_js_core_js_first(non_nil) instanceof Map ? (() => {
            let r = new Map();
            return reduce__Users_seoksoonjang_dev_hql_src_hql_lib_stdlib_stdlib_hql_reduce((acc, m) => {
                m instanceof Map ? m.forEach((v, k) => acc.set(k, v)) : typeof m === "object" ? Object.entries(m).forEach((entry) => acc.set(entry["0"], entry["1"])) : null;
                return acc;
            }, r, non_nil);
        })() : Object.assign(__hql_hash_map(), ...non_nil);
    })();
});
(throwEmptyTypeError__Users_seoksoonjang_dev_hql_src_hql_lib_stdlib_stdlib_hql_throwEmptyTypeError = function throwEmptyTypeError__Users_seoksoonjang_dev_hql_src_hql_lib_stdlib_stdlib_hql_throwEmptyTypeError(coll) {
    throw TypeError("Cannot create empty collection from " + typeof coll);
});
(empty__Users_seoksoonjang_dev_hql_src_hql_lib_stdlib_stdlib_hql_empty = function empty__Users_seoksoonjang_dev_hql_src_hql_lib_stdlib_stdlib_hql_empty(coll) {
    return isNil(coll) ? null : Array.isArray(coll) ? [] : typeof coll === "string" ? "" : coll instanceof Set ? new Set() : coll instanceof Map ? new Map() : typeof coll === "object" ? coll._realize && typeof coll._realize === "function" ? null : __hql_hash_map() : throwEmptyTypeError__Users_seoksoonjang_dev_hql_src_hql_lib_stdlib_stdlib_hql_throwEmptyTypeError(coll);
});
(conj__Users_seoksoonjang_dev_hql_src_hql_lib_stdlib_stdlib_hql_conj = function conj__Users_seoksoonjang_dev_hql_src_hql_lib_stdlib_stdlib_hql_conj(coll, ...items) {
    try {
        return isNil(seq__Users_seoksoonjang_dev_hql_src_hql_lib_stdlib_js_core_js_seq(items)) ? isNil(coll) ? [] : coll : isNil(coll) ? [...items] : Array.isArray(coll) ? [...coll, ...items] : coll instanceof Set ? (() => {
            let r = new Set(coll);
            return reduce__Users_seoksoonjang_dev_hql_src_hql_lib_stdlib_stdlib_hql_reduce((acc, item) => {
                acc.add(item);
                return acc;
            }, r, items);
        })() : coll instanceof Map ? ((reduce__Users_seoksoonjang_dev_hql_src_hql_lib_stdlib_stdlib_hql_reduce((_, item) => {
            if ((Array.isArray(item) ? false : true) || (item.length === 2 ? false : true)) {
                ((() => { throw TypeError("Map entries must be [key, value] pairs"); })());
            }
            else {
                return null;
            }
        }, null, items), (() => {
            let r = new Map(coll);
            return reduce__Users_seoksoonjang_dev_hql_src_hql_lib_stdlib_stdlib_hql_reduce((acc, item) => {
                acc.set(item["0"], item["1"]);
                return acc;
            }, r, items);
        })())) : typeof coll === "string" ? reduce__Users_seoksoonjang_dev_hql_src_hql_lib_stdlib_stdlib_hql_reduce((acc, item) => acc + item, coll, items) : ((reduce__Users_seoksoonjang_dev_hql_src_hql_lib_stdlib_stdlib_hql_reduce((_, item) => {
            if ((Array.isArray(item) ? false : true) || (item.length === 2 ? false : true)) {
                ((() => { throw TypeError("Object entries must be [key, value] pairs"); })());
            }
            else {
                return null;
            }
        }, null, items), reduce__Users_seoksoonjang_dev_hql_src_hql_lib_stdlib_stdlib_hql_reduce((acc, item) => {
            acc[item["0"]] = item["1"];
            return acc;
        }, { ...coll }, items)));
    }
    catch (__hql_ret__) {
        if (__hql_ret__ && __hql_ret__.__hql_early_return__) {
            return __hql_ret__.value;
        }
        else {
            throw __hql_ret__;
        }
    }
});
(into__Users_seoksoonjang_dev_hql_src_hql_lib_stdlib_stdlib_hql_into = function into__Users_seoksoonjang_dev_hql_src_hql_lib_stdlib_stdlib_hql_into(...args) {
    try {
        return (() => {
            let argc = count__Users_seoksoonjang_dev_hql_src_hql_lib_stdlib_stdlib_hql_count(args);
            if (argc === 2) {
                return (() => {
                    let to = first__Users_seoksoonjang_dev_hql_src_hql_lib_stdlib_js_core_js_first(args);
                    let _from = nth__Users_seoksoonjang_dev_hql_src_hql_lib_stdlib_stdlib_hql_nth(args, 1);
                    return isNil(_from) ? isNil(to) ? [] : to : isNil(to) ? Array.from(_from) : Array.isArray(to) ? (() => {
                        let arr = Array.from(to);
                        return reduce__Users_seoksoonjang_dev_hql_src_hql_lib_stdlib_stdlib_hql_reduce((acc, item) => {
                            acc.push(item);
                            return acc;
                        }, arr, _from);
                    })() : to instanceof Set ? (() => {
                        let r = new Set(to);
                        return reduce__Users_seoksoonjang_dev_hql_src_hql_lib_stdlib_stdlib_hql_reduce((acc, item) => {
                            acc.add(item);
                            return acc;
                        }, r, _from);
                    })() : to instanceof Map ? (() => {
                        let r = new Map(to);
                        return reduce__Users_seoksoonjang_dev_hql_src_hql_lib_stdlib_stdlib_hql_reduce((acc, item) => {
                            Array.isArray(item) && item.length === 2 ? acc.set(item["0"], item["1"]) : acc;
                            return acc;
                        }, r, _from);
                    })() : reduce__Users_seoksoonjang_dev_hql_src_hql_lib_stdlib_stdlib_hql_reduce((acc, item) => conj__Users_seoksoonjang_dev_hql_src_hql_lib_stdlib_stdlib_hql_conj(acc, item), to, _from);
                })();
            }
            else if (argc === 3) {
                return (() => {
                    let to = first__Users_seoksoonjang_dev_hql_src_hql_lib_stdlib_js_core_js_first(args);
                    let xform = nth__Users_seoksoonjang_dev_hql_src_hql_lib_stdlib_stdlib_hql_nth(args, 1);
                    let _from = nth__Users_seoksoonjang_dev_hql_src_hql_lib_stdlib_stdlib_hql_nth(args, 2);
                    return intoXform(to, xform, _from);
                })();
            }
            else {
                ((() => { throw TypeError("into requires 2 or 3 arguments"); })());
            }
        })();
    }
    catch (__hql_ret__) {
        if (__hql_ret__ && __hql_ret__.__hql_early_return__) {
            return __hql_ret__.value;
        }
        else {
            throw __hql_ret__;
        }
    }
});
(vec__Users_seoksoonjang_dev_hql_src_hql_lib_stdlib_stdlib_hql_vec = function vec__Users_seoksoonjang_dev_hql_src_hql_lib_stdlib_stdlib_hql_vec(coll) {
    return isNil(coll) ? [] : Array.from(coll);
});
(set__Users_seoksoonjang_dev_hql_src_hql_lib_stdlib_stdlib_hql_set = function set__Users_seoksoonjang_dev_hql_src_hql_lib_stdlib_stdlib_hql_set(coll) {
    return isNil(coll) ? new Set() : new Set(coll);
});
(doall__Users_seoksoonjang_dev_hql_src_hql_lib_stdlib_stdlib_hql_doall = function doall__Users_seoksoonjang_dev_hql_src_hql_lib_stdlib_stdlib_hql_doall(coll) {
    return isNil(coll) ? [] : Array.isArray(coll) ? coll : Array.from(coll);
});
(comp__Users_seoksoonjang_dev_hql_src_hql_lib_stdlib_stdlib_hql_comp = function comp__Users_seoksoonjang_dev_hql_src_hql_lib_stdlib_stdlib_hql_comp(...fns) {
    try {
        ((__init_0, __init_1) => {
            let i = __init_0;
            let s = __init_1;
            while (s) {
                if (typeof first__Users_seoksoonjang_dev_hql_src_hql_lib_stdlib_js_core_js_first(s) === "function" ? false : true) {
                    ((() => { throw TypeError("comp: argument " + (i + 1) + " must be a function"); })());
                }
                else {
                    null;
                }
                const __hql_temp_s = seq__Users_seoksoonjang_dev_hql_src_hql_lib_stdlib_js_core_js_seq(rest__Users_seoksoonjang_dev_hql_src_hql_lib_stdlib_js_core_js_rest(s));
                s = __hql_temp_s;
                i++;
            }
            return null;
        })(0, seq__Users_seoksoonjang_dev_hql_src_hql_lib_stdlib_js_core_js_seq(fns));
        return isNil(seq__Users_seoksoonjang_dev_hql_src_hql_lib_stdlib_js_core_js_seq(fns)) ? ((x) => x) : isNil(seq__Users_seoksoonjang_dev_hql_src_hql_lib_stdlib_js_core_js_seq(rest__Users_seoksoonjang_dev_hql_src_hql_lib_stdlib_js_core_js_rest(fns))) ? first__Users_seoksoonjang_dev_hql_src_hql_lib_stdlib_js_core_js_first(fns) : ((...args) => (() => {
            let reversed = reverse__Users_seoksoonjang_dev_hql_src_hql_lib_stdlib_stdlib_hql_reverse(fns);
            let init_result = apply__Users_seoksoonjang_dev_hql_src_hql_lib_stdlib_stdlib_hql_apply(first__Users_seoksoonjang_dev_hql_src_hql_lib_stdlib_js_core_js_first(reversed), args);
            return reduce__Users_seoksoonjang_dev_hql_src_hql_lib_stdlib_stdlib_hql_reduce((result, f) => f(result), init_result, rest__Users_seoksoonjang_dev_hql_src_hql_lib_stdlib_js_core_js_rest(reversed));
        })());
    }
    catch (__hql_ret__) {
        if (__hql_ret__ && __hql_ret__.__hql_early_return__) {
            return __hql_ret__.value;
        }
        else {
            throw __hql_ret__;
        }
    }
});
(partial__Users_seoksoonjang_dev_hql_src_hql_lib_stdlib_stdlib_hql_partial = function partial__Users_seoksoonjang_dev_hql_src_hql_lib_stdlib_stdlib_hql_partial(f, ...args) {
    if (typeof f === "function" ? false : true) {
        throw TypeError("partial: function must be a function");
    }
    else {
        null;
    }
    return (...more_args) => apply__Users_seoksoonjang_dev_hql_src_hql_lib_stdlib_stdlib_hql_apply(f, concat__Users_seoksoonjang_dev_hql_src_hql_lib_stdlib_stdlib_hql_concat(args, more_args));
});
(apply__Users_seoksoonjang_dev_hql_src_hql_lib_stdlib_stdlib_hql_apply = function apply__Users_seoksoonjang_dev_hql_src_hql_lib_stdlib_stdlib_hql_apply(f, args) {
    if (typeof f === "function" ? false : true) {
        throw TypeError("apply: function must be a function");
    }
    else {
        null;
    }
    if (args == null || (typeof args[Symbol.iterator] === "function" ? false : true)) {
        throw TypeError("apply: args must be iterable");
    }
    else {
        null;
    }
    return (() => {
        let arr = Array.isArray(args) ? args : Array.from(args);
        return f.apply(null, arr);
    })();
});
(sort__Users_seoksoonjang_dev_hql_src_hql_lib_stdlib_stdlib_hql_sort = function sort__Users_seoksoonjang_dev_hql_src_hql_lib_stdlib_stdlib_hql_sort(...args) {
    return isNil(seq__Users_seoksoonjang_dev_hql_src_hql_lib_stdlib_js_core_js_seq(rest__Users_seoksoonjang_dev_hql_src_hql_lib_stdlib_js_core_js_rest(args))) ? (() => {
        let arr = isNil(first__Users_seoksoonjang_dev_hql_src_hql_lib_stdlib_js_core_js_first(args)) ? [] : Array.from(first__Users_seoksoonjang_dev_hql_src_hql_lib_stdlib_js_core_js_first(args));
        return arr.sort((a, b) => a < b ? -1 : a > b ? 1 : 0);
    })() : (() => {
        let comp = first__Users_seoksoonjang_dev_hql_src_hql_lib_stdlib_js_core_js_first(args);
        let arr = isNil(second__Users_seoksoonjang_dev_hql_src_hql_lib_stdlib_stdlib_hql_second(args)) ? [] : Array.from(second__Users_seoksoonjang_dev_hql_src_hql_lib_stdlib_stdlib_hql_second(args));
        return arr.sort(comp);
    })();
});
(sortBy__Users_seoksoonjang_dev_hql_src_hql_lib_stdlib_stdlib_hql_sortBy = function sortBy__Users_seoksoonjang_dev_hql_src_hql_lib_stdlib_stdlib_hql_sortBy(keyfn, ...args) {
    return isNil(seq__Users_seoksoonjang_dev_hql_src_hql_lib_stdlib_js_core_js_seq(rest__Users_seoksoonjang_dev_hql_src_hql_lib_stdlib_js_core_js_rest(args))) ? (() => {
        let arr = isNil(first__Users_seoksoonjang_dev_hql_src_hql_lib_stdlib_js_core_js_first(args)) ? [] : Array.from(first__Users_seoksoonjang_dev_hql_src_hql_lib_stdlib_js_core_js_first(args));
        return arr.sort((a, b) => (() => {
            let ka = keyfn(a);
            let kb = keyfn(b);
            return ka < kb ? -1 : ka > kb ? 1 : 0;
        })());
    })() : (() => {
        let comp = first__Users_seoksoonjang_dev_hql_src_hql_lib_stdlib_js_core_js_first(args);
        let arr = isNil(second__Users_seoksoonjang_dev_hql_src_hql_lib_stdlib_stdlib_hql_second(args)) ? [] : Array.from(second__Users_seoksoonjang_dev_hql_src_hql_lib_stdlib_stdlib_hql_second(args));
        return arr.sort((a, b) => comp__Users_seoksoonjang_dev_hql_src_hql_lib_stdlib_stdlib_hql_comp(keyfn(a), keyfn(b)));
    })();
});
(mapT__Users_seoksoonjang_dev_hql_src_hql_lib_stdlib_stdlib_hql_mapT = function mapT__Users_seoksoonjang_dev_hql_src_hql_lib_stdlib_stdlib_hql_mapT(f) {
    if (typeof f === "function" ? false : true) {
        throw TypeError("mapT: f must be a function");
    }
    else {
        null;
    }
    return (rf) => (() => {
        let rf_init = rf[TRANSDUCER_INIT__Users_seoksoonjang_dev_hql_src_hql_lib_stdlib_js_internal_seq_protocol_js_TRANSDUCER_INIT];
        let rf_step = rf[TRANSDUCER_STEP__Users_seoksoonjang_dev_hql_src_hql_lib_stdlib_js_internal_seq_protocol_js_TRANSDUCER_STEP];
        let rf_result = rf[TRANSDUCER_RESULT__Users_seoksoonjang_dev_hql_src_hql_lib_stdlib_js_internal_seq_protocol_js_TRANSDUCER_RESULT];
        return __hql_hash_map(TRANSDUCER_INIT__Users_seoksoonjang_dev_hql_src_hql_lib_stdlib_js_internal_seq_protocol_js_TRANSDUCER_INIT, () => rf_init(), TRANSDUCER_STEP__Users_seoksoonjang_dev_hql_src_hql_lib_stdlib_js_internal_seq_protocol_js_TRANSDUCER_STEP, (result, input) => rf_step(result, f(input)), TRANSDUCER_RESULT__Users_seoksoonjang_dev_hql_src_hql_lib_stdlib_js_internal_seq_protocol_js_TRANSDUCER_RESULT, (result) => rf_result(result));
    })();
});
(filterT__Users_seoksoonjang_dev_hql_src_hql_lib_stdlib_stdlib_hql_filterT = function filterT__Users_seoksoonjang_dev_hql_src_hql_lib_stdlib_stdlib_hql_filterT(pred) {
    if (typeof pred === "function" ? false : true) {
        throw TypeError("filterT: pred must be a function");
    }
    else {
        null;
    }
    return (rf) => (() => {
        let rf_init = rf[TRANSDUCER_INIT__Users_seoksoonjang_dev_hql_src_hql_lib_stdlib_js_internal_seq_protocol_js_TRANSDUCER_INIT];
        let rf_step = rf[TRANSDUCER_STEP__Users_seoksoonjang_dev_hql_src_hql_lib_stdlib_js_internal_seq_protocol_js_TRANSDUCER_STEP];
        let rf_result = rf[TRANSDUCER_RESULT__Users_seoksoonjang_dev_hql_src_hql_lib_stdlib_js_internal_seq_protocol_js_TRANSDUCER_RESULT];
        return __hql_hash_map(TRANSDUCER_INIT__Users_seoksoonjang_dev_hql_src_hql_lib_stdlib_js_internal_seq_protocol_js_TRANSDUCER_INIT, () => rf_init(), TRANSDUCER_STEP__Users_seoksoonjang_dev_hql_src_hql_lib_stdlib_js_internal_seq_protocol_js_TRANSDUCER_STEP, (result, input) => pred(input) ? rf_step(result, input) : result, TRANSDUCER_RESULT__Users_seoksoonjang_dev_hql_src_hql_lib_stdlib_js_internal_seq_protocol_js_TRANSDUCER_RESULT, (result) => rf_result(result));
    })();
});
(takeT__Users_seoksoonjang_dev_hql_src_hql_lib_stdlib_stdlib_hql_takeT = function takeT__Users_seoksoonjang_dev_hql_src_hql_lib_stdlib_stdlib_hql_takeT(n) {
    if ((typeof n === "number" ? false : true) || n < 0) {
        throw TypeError("takeT: n must be a non-negative number");
    }
    else {
        null;
    }
    return (rf) => (() => {
        let rf_init = rf[TRANSDUCER_INIT__Users_seoksoonjang_dev_hql_src_hql_lib_stdlib_js_internal_seq_protocol_js_TRANSDUCER_INIT];
        let rf_step = rf[TRANSDUCER_STEP__Users_seoksoonjang_dev_hql_src_hql_lib_stdlib_js_internal_seq_protocol_js_TRANSDUCER_STEP];
        let rf_result = rf[TRANSDUCER_RESULT__Users_seoksoonjang_dev_hql_src_hql_lib_stdlib_js_internal_seq_protocol_js_TRANSDUCER_RESULT];
        let state = __hql_hash_map("taken", 0);
        return __hql_hash_map(TRANSDUCER_INIT__Users_seoksoonjang_dev_hql_src_hql_lib_stdlib_js_internal_seq_protocol_js_TRANSDUCER_INIT, () => rf_init(), TRANSDUCER_STEP__Users_seoksoonjang_dev_hql_src_hql_lib_stdlib_js_internal_seq_protocol_js_TRANSDUCER_STEP, (result, input) => state.taken < n ? ((state.taken = state.taken + 1, (() => {
            let r = rf_step(result, input);
            return state.taken >= n ? ensureReduced__Users_seoksoonjang_dev_hql_src_hql_lib_stdlib_js_internal_seq_protocol_js_ensureReduced(r) : r;
        })())) : ensureReduced__Users_seoksoonjang_dev_hql_src_hql_lib_stdlib_js_internal_seq_protocol_js_ensureReduced(result), TRANSDUCER_RESULT__Users_seoksoonjang_dev_hql_src_hql_lib_stdlib_js_internal_seq_protocol_js_TRANSDUCER_RESULT, (result) => rf_result(result));
    })();
});
(dropT__Users_seoksoonjang_dev_hql_src_hql_lib_stdlib_stdlib_hql_dropT = function dropT__Users_seoksoonjang_dev_hql_src_hql_lib_stdlib_stdlib_hql_dropT(n) {
    if ((typeof n === "number" ? false : true) || n < 0) {
        throw TypeError("dropT: n must be a non-negative number");
    }
    else {
        null;
    }
    return (rf) => (() => {
        let rf_init = rf[TRANSDUCER_INIT__Users_seoksoonjang_dev_hql_src_hql_lib_stdlib_js_internal_seq_protocol_js_TRANSDUCER_INIT];
        let rf_step = rf[TRANSDUCER_STEP__Users_seoksoonjang_dev_hql_src_hql_lib_stdlib_js_internal_seq_protocol_js_TRANSDUCER_STEP];
        let rf_result = rf[TRANSDUCER_RESULT__Users_seoksoonjang_dev_hql_src_hql_lib_stdlib_js_internal_seq_protocol_js_TRANSDUCER_RESULT];
        let state = __hql_hash_map("dropped", 0);
        return __hql_hash_map(TRANSDUCER_INIT__Users_seoksoonjang_dev_hql_src_hql_lib_stdlib_js_internal_seq_protocol_js_TRANSDUCER_INIT, () => rf_init(), TRANSDUCER_STEP__Users_seoksoonjang_dev_hql_src_hql_lib_stdlib_js_internal_seq_protocol_js_TRANSDUCER_STEP, (result, input) => state.dropped < n ? ((state.dropped = state.dropped + 1, result)) : rf_step(result, input), TRANSDUCER_RESULT__Users_seoksoonjang_dev_hql_src_hql_lib_stdlib_js_internal_seq_protocol_js_TRANSDUCER_RESULT, (result) => rf_result(result));
    })();
});
(takeWhileT__Users_seoksoonjang_dev_hql_src_hql_lib_stdlib_stdlib_hql_takeWhileT = function takeWhileT__Users_seoksoonjang_dev_hql_src_hql_lib_stdlib_stdlib_hql_takeWhileT(pred) {
    if (typeof pred === "function" ? false : true) {
        throw TypeError("takeWhileT: pred must be a function");
    }
    else {
        null;
    }
    return (rf) => (() => {
        let rf_init = rf[TRANSDUCER_INIT__Users_seoksoonjang_dev_hql_src_hql_lib_stdlib_js_internal_seq_protocol_js_TRANSDUCER_INIT];
        let rf_step = rf[TRANSDUCER_STEP__Users_seoksoonjang_dev_hql_src_hql_lib_stdlib_js_internal_seq_protocol_js_TRANSDUCER_STEP];
        let rf_result = rf[TRANSDUCER_RESULT__Users_seoksoonjang_dev_hql_src_hql_lib_stdlib_js_internal_seq_protocol_js_TRANSDUCER_RESULT];
        return __hql_hash_map(TRANSDUCER_INIT__Users_seoksoonjang_dev_hql_src_hql_lib_stdlib_js_internal_seq_protocol_js_TRANSDUCER_INIT, () => rf_init(), TRANSDUCER_STEP__Users_seoksoonjang_dev_hql_src_hql_lib_stdlib_js_internal_seq_protocol_js_TRANSDUCER_STEP, (result, input) => pred(input) ? rf_step(result, input) : reduced__Users_seoksoonjang_dev_hql_src_hql_lib_stdlib_js_internal_seq_protocol_js_reduced(result), TRANSDUCER_RESULT__Users_seoksoonjang_dev_hql_src_hql_lib_stdlib_js_internal_seq_protocol_js_TRANSDUCER_RESULT, (result) => rf_result(result));
    })();
});
(dropWhileT__Users_seoksoonjang_dev_hql_src_hql_lib_stdlib_stdlib_hql_dropWhileT = function dropWhileT__Users_seoksoonjang_dev_hql_src_hql_lib_stdlib_stdlib_hql_dropWhileT(pred) {
    if (typeof pred === "function" ? false : true) {
        throw TypeError("dropWhileT: pred must be a function");
    }
    else {
        null;
    }
    return (rf) => (() => {
        let rf_init = rf[TRANSDUCER_INIT__Users_seoksoonjang_dev_hql_src_hql_lib_stdlib_js_internal_seq_protocol_js_TRANSDUCER_INIT];
        let rf_step = rf[TRANSDUCER_STEP__Users_seoksoonjang_dev_hql_src_hql_lib_stdlib_js_internal_seq_protocol_js_TRANSDUCER_STEP];
        let rf_result = rf[TRANSDUCER_RESULT__Users_seoksoonjang_dev_hql_src_hql_lib_stdlib_js_internal_seq_protocol_js_TRANSDUCER_RESULT];
        let state = __hql_hash_map("dropping", true);
        return __hql_hash_map(TRANSDUCER_INIT__Users_seoksoonjang_dev_hql_src_hql_lib_stdlib_js_internal_seq_protocol_js_TRANSDUCER_INIT, () => rf_init(), TRANSDUCER_STEP__Users_seoksoonjang_dev_hql_src_hql_lib_stdlib_js_internal_seq_protocol_js_TRANSDUCER_STEP, (result, input) => state.dropping ? pred(input) ? result : ((state.dropping = false, rf_step(result, input))) : rf_step(result, input), TRANSDUCER_RESULT__Users_seoksoonjang_dev_hql_src_hql_lib_stdlib_js_internal_seq_protocol_js_TRANSDUCER_RESULT, (result) => rf_result(result));
    })();
});
(distinctT__Users_seoksoonjang_dev_hql_src_hql_lib_stdlib_stdlib_hql_distinctT = function distinctT__Users_seoksoonjang_dev_hql_src_hql_lib_stdlib_stdlib_hql_distinctT() {
    return (rf) => (() => {
        let rf_init = rf[TRANSDUCER_INIT__Users_seoksoonjang_dev_hql_src_hql_lib_stdlib_js_internal_seq_protocol_js_TRANSDUCER_INIT];
        let rf_step = rf[TRANSDUCER_STEP__Users_seoksoonjang_dev_hql_src_hql_lib_stdlib_js_internal_seq_protocol_js_TRANSDUCER_STEP];
        let rf_result = rf[TRANSDUCER_RESULT__Users_seoksoonjang_dev_hql_src_hql_lib_stdlib_js_internal_seq_protocol_js_TRANSDUCER_RESULT];
        let seen = new Set();
        return __hql_hash_map(TRANSDUCER_INIT__Users_seoksoonjang_dev_hql_src_hql_lib_stdlib_js_internal_seq_protocol_js_TRANSDUCER_INIT, () => rf_init(), TRANSDUCER_STEP__Users_seoksoonjang_dev_hql_src_hql_lib_stdlib_js_internal_seq_protocol_js_TRANSDUCER_STEP, (result, input) => seen.has(input) ? result : ((seen.add(input), rf_step(result, input))), TRANSDUCER_RESULT__Users_seoksoonjang_dev_hql_src_hql_lib_stdlib_js_internal_seq_protocol_js_TRANSDUCER_RESULT, (result) => rf_result(result));
    })();
});
(partitionAllT__Users_seoksoonjang_dev_hql_src_hql_lib_stdlib_stdlib_hql_partitionAllT = function partitionAllT__Users_seoksoonjang_dev_hql_src_hql_lib_stdlib_stdlib_hql_partitionAllT(n) {
    if ((typeof n === "number" ? false : true) || n < 1) {
        throw TypeError("partitionAllT: n must be a positive number");
    }
    else {
        null;
    }
    return (rf) => (() => {
        let rf_init = rf[TRANSDUCER_INIT__Users_seoksoonjang_dev_hql_src_hql_lib_stdlib_js_internal_seq_protocol_js_TRANSDUCER_INIT];
        let rf_step = rf[TRANSDUCER_STEP__Users_seoksoonjang_dev_hql_src_hql_lib_stdlib_js_internal_seq_protocol_js_TRANSDUCER_STEP];
        let rf_result = rf[TRANSDUCER_RESULT__Users_seoksoonjang_dev_hql_src_hql_lib_stdlib_js_internal_seq_protocol_js_TRANSDUCER_RESULT];
        let state = __hql_hash_map("buffer", []);
        return __hql_hash_map(TRANSDUCER_INIT__Users_seoksoonjang_dev_hql_src_hql_lib_stdlib_js_internal_seq_protocol_js_TRANSDUCER_INIT, () => rf_init(), TRANSDUCER_STEP__Users_seoksoonjang_dev_hql_src_hql_lib_stdlib_js_internal_seq_protocol_js_TRANSDUCER_STEP, (result, input) => (() => {
            let buf = state.buffer;
            buf.push(input);
            return buf.length === n ? (() => {
                let chunk = buf;
                state.buffer = [];
                return rf_step(result, chunk);
            })() : result;
        })(), TRANSDUCER_RESULT__Users_seoksoonjang_dev_hql_src_hql_lib_stdlib_js_internal_seq_protocol_js_TRANSDUCER_RESULT, (result) => (() => {
            let buf = state.buffer;
            let res = buf.length > 0 ? (() => {
                let r = rf_step(result, buf);
                state.buffer = [];
                return r;
            })() : result;
            return rf_result(isReduced__Users_seoksoonjang_dev_hql_src_hql_lib_stdlib_js_internal_seq_protocol_js_isReduced(res) ? res._val : res);
        })());
    })();
});
(composeTransducers__Users_seoksoonjang_dev_hql_src_hql_lib_stdlib_stdlib_hql_composeTransducers = function composeTransducers__Users_seoksoonjang_dev_hql_src_hql_lib_stdlib_stdlib_hql_composeTransducers(...xforms) {
    return isNil(seq__Users_seoksoonjang_dev_hql_src_hql_lib_stdlib_js_core_js_seq(xforms)) ? ((rf) => rf) : isNil(seq__Users_seoksoonjang_dev_hql_src_hql_lib_stdlib_js_core_js_seq(rest__Users_seoksoonjang_dev_hql_src_hql_lib_stdlib_js_core_js_rest(xforms))) ? first__Users_seoksoonjang_dev_hql_src_hql_lib_stdlib_js_core_js_first(xforms) : ((rf) => reduce__Users_seoksoonjang_dev_hql_src_hql_lib_stdlib_stdlib_hql_reduce((composed, xf) => xf(composed), rf, reverse__Users_seoksoonjang_dev_hql_src_hql_lib_stdlib_stdlib_hql_reverse(xforms)));
});
(frequencies__Users_seoksoonjang_dev_hql_src_hql_lib_stdlib_stdlib_hql_frequencies = function frequencies__Users_seoksoonjang_dev_hql_src_hql_lib_stdlib_stdlib_hql_frequencies(coll) {
    return reduce__Users_seoksoonjang_dev_hql_src_hql_lib_stdlib_stdlib_hql_reduce((acc, item) => (() => {
        let cnt = acc[item] || 0;
        acc[item] = cnt + 1;
        return acc;
    })(), __hql_hash_map(), coll);
});
(selectKeys__Users_seoksoonjang_dev_hql_src_hql_lib_stdlib_stdlib_hql_selectKeys = function selectKeys__Users_seoksoonjang_dev_hql_src_hql_lib_stdlib_stdlib_hql_selectKeys(m, ks) {
    return reduce__Users_seoksoonjang_dev_hql_src_hql_lib_stdlib_stdlib_hql_reduce((acc, k) => (() => {
        let v = m[k];
        return v === undefined ? acc : ((acc[k] = v, acc));
    })(), __hql_hash_map(), ks);
});
(mergeWith__Users_seoksoonjang_dev_hql_src_hql_lib_stdlib_stdlib_hql_mergeWith = function mergeWith__Users_seoksoonjang_dev_hql_src_hql_lib_stdlib_stdlib_hql_mergeWith(f, ...maps) {
    return reduce__Users_seoksoonjang_dev_hql_src_hql_lib_stdlib_stdlib_hql_reduce((acc, m) => isNil(m) ? acc : (() => {
        let ks = Object.keys(m);
        return reduce__Users_seoksoonjang_dev_hql_src_hql_lib_stdlib_stdlib_hql_reduce((a, k) => (() => {
            let existing = a[k];
            existing === undefined ? a[k] = m[k] : (a[k] = f(existing, m[k]));
            return a;
        })(), acc, ks);
    })(), __hql_hash_map(), maps);
});
(remove__Users_seoksoonjang_dev_hql_src_hql_lib_stdlib_stdlib_hql_remove = function remove__Users_seoksoonjang_dev_hql_src_hql_lib_stdlib_stdlib_hql_remove(pred, coll) {
    return filter__Users_seoksoonjang_dev_hql_src_hql_lib_stdlib_stdlib_hql_filter((x) => pred(x) ? false : true, coll);
});
(complement__Users_seoksoonjang_dev_hql_src_hql_lib_stdlib_stdlib_hql_complement = function complement__Users_seoksoonjang_dev_hql_src_hql_lib_stdlib_stdlib_hql_complement(f) {
    return (...args) => apply__Users_seoksoonjang_dev_hql_src_hql_lib_stdlib_stdlib_hql_apply(f, args) ? false : true;
});
(memoize__Users_seoksoonjang_dev_hql_src_hql_lib_stdlib_stdlib_hql_memoize = function memoize__Users_seoksoonjang_dev_hql_src_hql_lib_stdlib_stdlib_hql_memoize(f) {
    return (() => {
        let cache = new Map();
        return (...args) => (() => {
            let argc = count__Users_seoksoonjang_dev_hql_src_hql_lib_stdlib_stdlib_hql_count(args);
            let k = argc === 0 ? "__memoize_no_args__" : argc === 1 ? first__Users_seoksoonjang_dev_hql_src_hql_lib_stdlib_js_core_js_first(args) : args.map((a) => +a).join("\u0000");
            return cache.has(k) ? cache.get(k) : (() => {
                let result = apply__Users_seoksoonjang_dev_hql_src_hql_lib_stdlib_stdlib_hql_apply(f, args);
                cache.set(k, result);
                return result;
            })();
        })();
    })();
});
(notEmpty__Users_seoksoonjang_dev_hql_src_hql_lib_stdlib_stdlib_hql_notEmpty = function notEmpty__Users_seoksoonjang_dev_hql_src_hql_lib_stdlib_stdlib_hql_notEmpty(coll) {
    return seq__Users_seoksoonjang_dev_hql_src_hql_lib_stdlib_js_core_js_seq(coll) ? coll : null;
});
(boundedCount__Users_seoksoonjang_dev_hql_src_hql_lib_stdlib_stdlib_hql_boundedCount = function boundedCount__Users_seoksoonjang_dev_hql_src_hql_lib_stdlib_stdlib_hql_boundedCount(n, coll) {
    return ((__init_0, __init_1) => {
        let i = __init_0;
        let s = __init_1;
        while (!(isNil(s) || i >= n)) {
            const __hql_temp_s = rest__Users_seoksoonjang_dev_hql_src_hql_lib_stdlib_js_core_js_rest(s);
            s = __hql_temp_s;
            i++;
        }
        return i;
    })(0, seq__Users_seoksoonjang_dev_hql_src_hql_lib_stdlib_js_core_js_seq(coll));
});
(runBang__Users_seoksoonjang_dev_hql_src_hql_lib_stdlib_stdlib_hql_runBang = function runBang__Users_seoksoonjang_dev_hql_src_hql_lib_stdlib_stdlib_hql_runBang(f, coll) {
    reduce__Users_seoksoonjang_dev_hql_src_hql_lib_stdlib_stdlib_hql_reduce((_, item) => {
        f(item);
        return null;
    }, null, coll);
    return null;
});
(everyPred__Users_seoksoonjang_dev_hql_src_hql_lib_stdlib_stdlib_hql_everyPred = function everyPred__Users_seoksoonjang_dev_hql_src_hql_lib_stdlib_stdlib_hql_everyPred(...preds) {
    return (...args) => reduce__Users_seoksoonjang_dev_hql_src_hql_lib_stdlib_stdlib_hql_reduce((acc, pred) => acc ? reduce__Users_seoksoonjang_dev_hql_src_hql_lib_stdlib_stdlib_hql_reduce((a2, arg) => a2 ? pred(arg) : false, true, args) : false, true, preds);
});
(someFn__Users_seoksoonjang_dev_hql_src_hql_lib_stdlib_stdlib_hql_someFn = function someFn__Users_seoksoonjang_dev_hql_src_hql_lib_stdlib_stdlib_hql_someFn(...preds) {
    return (...args) => reduce__Users_seoksoonjang_dev_hql_src_hql_lib_stdlib_stdlib_hql_reduce((acc, pred) => acc ? acc : reduce__Users_seoksoonjang_dev_hql_src_hql_lib_stdlib_stdlib_hql_reduce((a2, arg) => a2 ? a2 : (() => {
        let r = pred(arg);
        return r ? r : null;
    })(), null, args), null, preds);
});
(cat__Users_seoksoonjang_dev_hql_src_hql_lib_stdlib_stdlib_hql_cat = function cat__Users_seoksoonjang_dev_hql_src_hql_lib_stdlib_stdlib_hql_cat(rf) {
    return (() => {
        let rf_init = rf[TRANSDUCER_INIT__Users_seoksoonjang_dev_hql_src_hql_lib_stdlib_js_internal_seq_protocol_js_TRANSDUCER_INIT];
        let rf_step = rf[TRANSDUCER_STEP__Users_seoksoonjang_dev_hql_src_hql_lib_stdlib_js_internal_seq_protocol_js_TRANSDUCER_STEP];
        let rf_result = rf[TRANSDUCER_RESULT__Users_seoksoonjang_dev_hql_src_hql_lib_stdlib_js_internal_seq_protocol_js_TRANSDUCER_RESULT];
        return __hql_hash_map(TRANSDUCER_INIT__Users_seoksoonjang_dev_hql_src_hql_lib_stdlib_js_internal_seq_protocol_js_TRANSDUCER_INIT, () => rf_init(), TRANSDUCER_STEP__Users_seoksoonjang_dev_hql_src_hql_lib_stdlib_js_internal_seq_protocol_js_TRANSDUCER_STEP, (result, input) => reduce__Users_seoksoonjang_dev_hql_src_hql_lib_stdlib_stdlib_hql_reduce((acc, item) => (() => {
            let r = rf_step(acc, item);
            return isReduced__Users_seoksoonjang_dev_hql_src_hql_lib_stdlib_js_internal_seq_protocol_js_isReduced(r) ? reduced__Users_seoksoonjang_dev_hql_src_hql_lib_stdlib_js_internal_seq_protocol_js_reduced(r) : r;
        })(), result, input), TRANSDUCER_RESULT__Users_seoksoonjang_dev_hql_src_hql_lib_stdlib_js_internal_seq_protocol_js_TRANSDUCER_RESULT, (result) => rf_result(result));
    })();
});
(dedupe__Users_seoksoonjang_dev_hql_src_hql_lib_stdlib_stdlib_hql_dedupe = function dedupe__Users_seoksoonjang_dev_hql_src_hql_lib_stdlib_stdlib_hql_dedupe(rf) {
    return (() => {
        let rf_init = rf[TRANSDUCER_INIT__Users_seoksoonjang_dev_hql_src_hql_lib_stdlib_js_internal_seq_protocol_js_TRANSDUCER_INIT];
        let rf_step = rf[TRANSDUCER_STEP__Users_seoksoonjang_dev_hql_src_hql_lib_stdlib_js_internal_seq_protocol_js_TRANSDUCER_STEP];
        let rf_result = rf[TRANSDUCER_RESULT__Users_seoksoonjang_dev_hql_src_hql_lib_stdlib_js_internal_seq_protocol_js_TRANSDUCER_RESULT];
        let state = new Object();
        state.prev = ___dedupe_none__;
        return __hql_hash_map(TRANSDUCER_INIT__Users_seoksoonjang_dev_hql_src_hql_lib_stdlib_js_internal_seq_protocol_js_TRANSDUCER_INIT, () => rf_init(), TRANSDUCER_STEP__Users_seoksoonjang_dev_hql_src_hql_lib_stdlib_js_internal_seq_protocol_js_TRANSDUCER_STEP, (result, input) => (() => {
            let p = state.prev;
            state.prev = input;
            return p === input ? result : rf_step(result, input);
        })(), TRANSDUCER_RESULT__Users_seoksoonjang_dev_hql_src_hql_lib_stdlib_js_internal_seq_protocol_js_TRANSDUCER_RESULT, (result) => rf_result(result));
    })();
});
(removeT__Users_seoksoonjang_dev_hql_src_hql_lib_stdlib_stdlib_hql_removeT = function removeT__Users_seoksoonjang_dev_hql_src_hql_lib_stdlib_stdlib_hql_removeT(pred) {
    return filterT__Users_seoksoonjang_dev_hql_src_hql_lib_stdlib_stdlib_hql_filterT((x) => pred(x) ? false : true);
});
(keepT__Users_seoksoonjang_dev_hql_src_hql_lib_stdlib_stdlib_hql_keepT = function keepT__Users_seoksoonjang_dev_hql_src_hql_lib_stdlib_stdlib_hql_keepT(f) {
    return (rf) => (() => {
        let rf_init = rf[TRANSDUCER_INIT__Users_seoksoonjang_dev_hql_src_hql_lib_stdlib_js_internal_seq_protocol_js_TRANSDUCER_INIT];
        let rf_step = rf[TRANSDUCER_STEP__Users_seoksoonjang_dev_hql_src_hql_lib_stdlib_js_internal_seq_protocol_js_TRANSDUCER_STEP];
        let rf_result = rf[TRANSDUCER_RESULT__Users_seoksoonjang_dev_hql_src_hql_lib_stdlib_js_internal_seq_protocol_js_TRANSDUCER_RESULT];
        return __hql_hash_map(TRANSDUCER_INIT__Users_seoksoonjang_dev_hql_src_hql_lib_stdlib_js_internal_seq_protocol_js_TRANSDUCER_INIT, () => rf_init(), TRANSDUCER_STEP__Users_seoksoonjang_dev_hql_src_hql_lib_stdlib_js_internal_seq_protocol_js_TRANSDUCER_STEP, (result, input) => (() => {
            let v = f(input);
            return isNil(v) ? result : rf_step(result, v);
        })(), TRANSDUCER_RESULT__Users_seoksoonjang_dev_hql_src_hql_lib_stdlib_js_internal_seq_protocol_js_TRANSDUCER_RESULT, (result) => rf_result(result));
    })();
});
(min__Users_seoksoonjang_dev_hql_src_hql_lib_stdlib_stdlib_hql_min = function min__Users_seoksoonjang_dev_hql_src_hql_lib_stdlib_stdlib_hql_min(...args) {
    return reduce__Users_seoksoonjang_dev_hql_src_hql_lib_stdlib_stdlib_hql_reduce((a, b) => a < b ? a : b, args);
});
(max__Users_seoksoonjang_dev_hql_src_hql_lib_stdlib_stdlib_hql_max = function max__Users_seoksoonjang_dev_hql_src_hql_lib_stdlib_stdlib_hql_max(...args) {
    return reduce__Users_seoksoonjang_dev_hql_src_hql_lib_stdlib_stdlib_hql_reduce((a, b) => a > b ? a : b, args);
});
(fnil__Users_seoksoonjang_dev_hql_src_hql_lib_stdlib_stdlib_hql_fnil = function fnil__Users_seoksoonjang_dev_hql_src_hql_lib_stdlib_stdlib_hql_fnil(f, ...defaults) {
    return (...args) => (() => {
        let patched = vec__Users_seoksoonjang_dev_hql_src_hql_lib_stdlib_stdlib_hql_vec(mapIndexed__Users_seoksoonjang_dev_hql_src_hql_lib_stdlib_stdlib_hql_mapIndexed((i, arg) => isNil(arg) ? nth__Users_seoksoonjang_dev_hql_src_hql_lib_stdlib_stdlib_hql_nth(defaults, i, null) : arg, args));
        return apply__Users_seoksoonjang_dev_hql_src_hql_lib_stdlib_stdlib_hql_apply(f, patched);
    })();
});
(trampoline__Users_seoksoonjang_dev_hql_src_hql_lib_stdlib_stdlib_hql_trampoline = function trampoline__Users_seoksoonjang_dev_hql_src_hql_lib_stdlib_stdlib_hql_trampoline(f, ...args) {
    return (() => {
        let result = apply__Users_seoksoonjang_dev_hql_src_hql_lib_stdlib_stdlib_hql_apply(f, args);
        return (() => {
            let bounce;
            (bounce = (bounce = function bounce(r) {
                while (true) {
                    if (typeof r === "function") {
                        [r] = [r()];
                    }
                    else {
                        return r;
                    }
                }
            }));
            return bounce(result);
        })();
    })();
});
(strJoin__Users_seoksoonjang_dev_hql_src_hql_lib_stdlib_stdlib_hql_strJoin = function strJoin__Users_seoksoonjang_dev_hql_src_hql_lib_stdlib_stdlib_hql_strJoin(separator, coll) {
    return (() => {
        let arr = vec__Users_seoksoonjang_dev_hql_src_hql_lib_stdlib_stdlib_hql_vec(coll);
        return arr.join(isNil(separator) ? "" : separator);
    })();
});
(split__Users_seoksoonjang_dev_hql_src_hql_lib_stdlib_stdlib_hql_split = function split__Users_seoksoonjang_dev_hql_src_hql_lib_stdlib_stdlib_hql_split(s, separator) {
    return s.split(separator);
});
(replace___Users_seoksoonjang_dev_hql_src_hql_lib_stdlib_stdlib_hql_replace = function replace___Users_seoksoonjang_dev_hql_src_hql_lib_stdlib_stdlib_hql_replace(s, match, replacement) {
    return s.replaceAll(match, replacement);
});
(trim__Users_seoksoonjang_dev_hql_src_hql_lib_stdlib_stdlib_hql_trim = function trim__Users_seoksoonjang_dev_hql_src_hql_lib_stdlib_stdlib_hql_trim(s) {
    return s.trim();
});
(upperCase__Users_seoksoonjang_dev_hql_src_hql_lib_stdlib_stdlib_hql_upperCase = function upperCase__Users_seoksoonjang_dev_hql_src_hql_lib_stdlib_stdlib_hql_upperCase(s) {
    return s.toUpperCase();
});
(lowerCase__Users_seoksoonjang_dev_hql_src_hql_lib_stdlib_stdlib_hql_lowerCase = function lowerCase__Users_seoksoonjang_dev_hql_src_hql_lib_stdlib_stdlib_hql_lowerCase(s) {
    return s.toLowerCase();
});
(startsWith__Users_seoksoonjang_dev_hql_src_hql_lib_stdlib_stdlib_hql_startsWith = function startsWith__Users_seoksoonjang_dev_hql_src_hql_lib_stdlib_stdlib_hql_startsWith(s, prefix) {
    return s.startsWith(prefix);
});
(endsWith__Users_seoksoonjang_dev_hql_src_hql_lib_stdlib_stdlib_hql_endsWith = function endsWith__Users_seoksoonjang_dev_hql_src_hql_lib_stdlib_stdlib_hql_endsWith(s, suffix) {
    return s.endsWith(suffix);
});
(includes__Users_seoksoonjang_dev_hql_src_hql_lib_stdlib_stdlib_hql_includes = function includes__Users_seoksoonjang_dev_hql_src_hql_lib_stdlib_stdlib_hql_includes(s, substr) {
    return s.includes(substr);
});
(subs__Users_seoksoonjang_dev_hql_src_hql_lib_stdlib_stdlib_hql_subs = function subs__Users_seoksoonjang_dev_hql_src_hql_lib_stdlib_stdlib_hql_subs(s, start, ...args) {
    return (() => {
        let end = first__Users_seoksoonjang_dev_hql_src_hql_lib_stdlib_js_core_js_first(args);
        return isNil(end) ? s.substring(start) : s.substring(start, end);
    })();
});
(isKeyword__Users_seoksoonjang_dev_hql_src_hql_lib_stdlib_stdlib_hql_isKeyword = function isKeyword__Users_seoksoonjang_dev_hql_src_hql_lib_stdlib_stdlib_hql_isKeyword(x) {
    return typeof x === "string" && x.charAt(0) === ":";
});
(isSymbol__Users_seoksoonjang_dev_hql_src_hql_lib_stdlib_stdlib_hql_isSymbol = function isSymbol__Users_seoksoonjang_dev_hql_src_hql_lib_stdlib_stdlib_hql_isSymbol(x) {
    return typeof x === "symbol";
});
(isSeqable__Users_seoksoonjang_dev_hql_src_hql_lib_stdlib_stdlib_hql_isSeqable = function isSeqable__Users_seoksoonjang_dev_hql_src_hql_lib_stdlib_stdlib_hql_isSeqable(x) {
    return isNil(x) || (Array.isArray(x) || (typeof x === "string" || (isNil(x) ? false : true) && (typeof x === "object" && x !== null && !Array.isArray(x) && (typeof x.first === "function" && typeof x.rest === "function"))));
});
(isVector__Users_seoksoonjang_dev_hql_src_hql_lib_stdlib_stdlib_hql_isVector = function isVector__Users_seoksoonjang_dev_hql_src_hql_lib_stdlib_stdlib_hql_isVector(x) {
    return Array.isArray(x);
});
(isMap__Users_seoksoonjang_dev_hql_src_hql_lib_stdlib_stdlib_hql_isMap = function isMap__Users_seoksoonjang_dev_hql_src_hql_lib_stdlib_stdlib_hql_isMap(x) {
    return typeof x === "object" && x !== null && !Array.isArray(x) && ((Array.isArray(x) ? false : true) && ((x instanceof Set ? false : true) && (x instanceof Map ? false : true)));
});
(isSet__Users_seoksoonjang_dev_hql_src_hql_lib_stdlib_stdlib_hql_isSet = function isSet__Users_seoksoonjang_dev_hql_src_hql_lib_stdlib_stdlib_hql_isSet(x) {
    return x instanceof Set;
});
(isInt__Users_seoksoonjang_dev_hql_src_hql_lib_stdlib_stdlib_hql_isInt = function isInt__Users_seoksoonjang_dev_hql_src_hql_lib_stdlib_stdlib_hql_isInt(x) {
    return typeof x === "number" && Number.isInteger(x);
});
(isFloat__Users_seoksoonjang_dev_hql_src_hql_lib_stdlib_stdlib_hql_isFloat = function isFloat__Users_seoksoonjang_dev_hql_src_hql_lib_stdlib_stdlib_hql_isFloat(x) {
    return typeof x === "number" && (Number.isInteger(x) ? false : true);
});
(mapcatT__Users_seoksoonjang_dev_hql_src_hql_lib_stdlib_stdlib_hql_mapcatT = function mapcatT__Users_seoksoonjang_dev_hql_src_hql_lib_stdlib_stdlib_hql_mapcatT(f) {
    return composeTransducers__Users_seoksoonjang_dev_hql_src_hql_lib_stdlib_stdlib_hql_composeTransducers(mapT__Users_seoksoonjang_dev_hql_src_hql_lib_stdlib_stdlib_hql_mapT(f), cat__Users_seoksoonjang_dev_hql_src_hql_lib_stdlib_stdlib_hql_cat);
});
export { take__Users_seoksoonjang_dev_hql_src_hql_lib_stdlib_stdlib_hql_take as take, drop__Users_seoksoonjang_dev_hql_src_hql_lib_stdlib_stdlib_hql_drop as drop, map__Users_seoksoonjang_dev_hql_src_hql_lib_stdlib_stdlib_hql_map as map, filter__Users_seoksoonjang_dev_hql_src_hql_lib_stdlib_stdlib_hql_filter as filter, reduce__Users_seoksoonjang_dev_hql_src_hql_lib_stdlib_stdlib_hql_reduce as reduce, concat__Users_seoksoonjang_dev_hql_src_hql_lib_stdlib_stdlib_hql_concat as concat, flatten__Users_seoksoonjang_dev_hql_src_hql_lib_stdlib_stdlib_hql_flatten as flatten, distinct__Users_seoksoonjang_dev_hql_src_hql_lib_stdlib_stdlib_hql_distinct as distinct, next__Users_seoksoonjang_dev_hql_src_hql_lib_stdlib_stdlib_hql_next as next, nth__Users_seoksoonjang_dev_hql_src_hql_lib_stdlib_stdlib_hql_nth as nth, second__Users_seoksoonjang_dev_hql_src_hql_lib_stdlib_stdlib_hql_second as second, count__Users_seoksoonjang_dev_hql_src_hql_lib_stdlib_stdlib_hql_count as count, last__Users_seoksoonjang_dev_hql_src_hql_lib_stdlib_stdlib_hql_last as last, mapIndexed__Users_seoksoonjang_dev_hql_src_hql_lib_stdlib_stdlib_hql_mapIndexed as mapIndexed, keepIndexed__Users_seoksoonjang_dev_hql_src_hql_lib_stdlib_stdlib_hql_keepIndexed as keepIndexed, mapcat__Users_seoksoonjang_dev_hql_src_hql_lib_stdlib_stdlib_hql_mapcat as mapcat, keep__Users_seoksoonjang_dev_hql_src_hql_lib_stdlib_stdlib_hql_keep as keep, takeWhile__Users_seoksoonjang_dev_hql_src_hql_lib_stdlib_stdlib_hql_takeWhile as takeWhile, dropWhile__Users_seoksoonjang_dev_hql_src_hql_lib_stdlib_stdlib_hql_dropWhile as dropWhile, splitWith__Users_seoksoonjang_dev_hql_src_hql_lib_stdlib_stdlib_hql_splitWith as splitWith, splitAt__Users_seoksoonjang_dev_hql_src_hql_lib_stdlib_stdlib_hql_splitAt as splitAt, reductions__Users_seoksoonjang_dev_hql_src_hql_lib_stdlib_stdlib_hql_reductions as reductions, interpose__Users_seoksoonjang_dev_hql_src_hql_lib_stdlib_stdlib_hql_interpose as interpose, interleave__Users_seoksoonjang_dev_hql_src_hql_lib_stdlib_stdlib_hql_interleave as interleave, partition__Users_seoksoonjang_dev_hql_src_hql_lib_stdlib_stdlib_hql_partition as partition, partitionAll__Users_seoksoonjang_dev_hql_src_hql_lib_stdlib_stdlib_hql_partitionAll as partitionAll, partitionBy__Users_seoksoonjang_dev_hql_src_hql_lib_stdlib_stdlib_hql_partitionBy as partitionBy, isEmpty__Users_seoksoonjang_dev_hql_src_hql_lib_stdlib_stdlib_hql_isEmpty as isEmpty, some__Users_seoksoonjang_dev_hql_src_hql_lib_stdlib_stdlib_hql_some as some, every__Users_seoksoonjang_dev_hql_src_hql_lib_stdlib_stdlib_hql_every as every, notAny__Users_seoksoonjang_dev_hql_src_hql_lib_stdlib_stdlib_hql_notAny as notAny, notEvery__Users_seoksoonjang_dev_hql_src_hql_lib_stdlib_stdlib_hql_notEvery as notEvery, isSome__Users_seoksoonjang_dev_hql_src_hql_lib_stdlib_stdlib_hql_isSome as isSome, isNil__Users_seoksoonjang_dev_hql_src_hql_lib_stdlib_stdlib_hql_isNil as isNil, isEven__Users_seoksoonjang_dev_hql_src_hql_lib_stdlib_stdlib_hql_isEven as isEven, isOdd__Users_seoksoonjang_dev_hql_src_hql_lib_stdlib_stdlib_hql_isOdd as isOdd, isZero__Users_seoksoonjang_dev_hql_src_hql_lib_stdlib_stdlib_hql_isZero as isZero, isPositive__Users_seoksoonjang_dev_hql_src_hql_lib_stdlib_stdlib_hql_isPositive as isPositive, isNegative__Users_seoksoonjang_dev_hql_src_hql_lib_stdlib_stdlib_hql_isNegative as isNegative, isNumber__Users_seoksoonjang_dev_hql_src_hql_lib_stdlib_stdlib_hql_isNumber as isNumber, isString__Users_seoksoonjang_dev_hql_src_hql_lib_stdlib_stdlib_hql_isString as isString, isBoolean__Users_seoksoonjang_dev_hql_src_hql_lib_stdlib_stdlib_hql_isBoolean as isBoolean, isFunction__Users_seoksoonjang_dev_hql_src_hql_lib_stdlib_stdlib_hql_isFunction as isFunction, isArray__Users_seoksoonjang_dev_hql_src_hql_lib_stdlib_stdlib_hql_isArray as isArray, isObject__Users_seoksoonjang_dev_hql_src_hql_lib_stdlib_stdlib_hql_isObject as isObject, isDelay__Users_seoksoonjang_dev_hql_src_hql_lib_stdlib_stdlib_hql_isDelay as isDelay, force__Users_seoksoonjang_dev_hql_src_hql_lib_stdlib_stdlib_hql_force as force, realized__Users_seoksoonjang_dev_hql_src_hql_lib_stdlib_stdlib_hql_realized as realized, inc__Users_seoksoonjang_dev_hql_src_hql_lib_stdlib_stdlib_hql_inc as inc, dec__Users_seoksoonjang_dev_hql_src_hql_lib_stdlib_stdlib_hql_dec as dec, abs__Users_seoksoonjang_dev_hql_src_hql_lib_stdlib_stdlib_hql_abs as abs, add__Users_seoksoonjang_dev_hql_src_hql_lib_stdlib_stdlib_hql_add as add, sub__Users_seoksoonjang_dev_hql_src_hql_lib_stdlib_stdlib_hql_sub as sub, mul__Users_seoksoonjang_dev_hql_src_hql_lib_stdlib_stdlib_hql_mul as mul, div__Users_seoksoonjang_dev_hql_src_hql_lib_stdlib_stdlib_hql_div as div, mod__Users_seoksoonjang_dev_hql_src_hql_lib_stdlib_stdlib_hql_mod as mod, eq__Users_seoksoonjang_dev_hql_src_hql_lib_stdlib_stdlib_hql_eq as eq, neq__Users_seoksoonjang_dev_hql_src_hql_lib_stdlib_stdlib_hql_neq as neq, deepEqInternal__Users_seoksoonjang_dev_hql_src_hql_lib_stdlib_stdlib_hql_deepEqInternal as deepEqInternal, deepEq__Users_seoksoonjang_dev_hql_src_hql_lib_stdlib_stdlib_hql_deepEq as deepEq, lt__Users_seoksoonjang_dev_hql_src_hql_lib_stdlib_stdlib_hql_lt as lt, gt__Users_seoksoonjang_dev_hql_src_hql_lib_stdlib_stdlib_hql_gt as gt, lte__Users_seoksoonjang_dev_hql_src_hql_lib_stdlib_stdlib_hql_lte as lte, gte__Users_seoksoonjang_dev_hql_src_hql_lib_stdlib_stdlib_hql_gte as gte, symbol__Users_seoksoonjang_dev_hql_src_hql_lib_stdlib_stdlib_hql_symbol as symbol, keyword__Users_seoksoonjang_dev_hql_src_hql_lib_stdlib_stdlib_hql_keyword as keyword, name__Users_seoksoonjang_dev_hql_src_hql_lib_stdlib_stdlib_hql_name as name, repeat__Users_seoksoonjang_dev_hql_src_hql_lib_stdlib_stdlib_hql_repeat as repeat, repeatedly__Users_seoksoonjang_dev_hql_src_hql_lib_stdlib_stdlib_hql_repeatedly as repeatedly, cycle__Users_seoksoonjang_dev_hql_src_hql_lib_stdlib_stdlib_hql_cycle as cycle, iterate__Users_seoksoonjang_dev_hql_src_hql_lib_stdlib_stdlib_hql_iterate as iterate, keys__Users_seoksoonjang_dev_hql_src_hql_lib_stdlib_stdlib_hql_keys as keys, groupBy__Users_seoksoonjang_dev_hql_src_hql_lib_stdlib_stdlib_hql_groupBy as groupBy, reverse__Users_seoksoonjang_dev_hql_src_hql_lib_stdlib_stdlib_hql_reverse as reverse, identity__Users_seoksoonjang_dev_hql_src_hql_lib_stdlib_stdlib_hql_identity as identity, constantly__Users_seoksoonjang_dev_hql_src_hql_lib_stdlib_stdlib_hql_constantly as constantly, vals__Users_seoksoonjang_dev_hql_src_hql_lib_stdlib_stdlib_hql_vals as vals, juxt__Users_seoksoonjang_dev_hql_src_hql_lib_stdlib_stdlib_hql_juxt as juxt, zipmap__Users_seoksoonjang_dev_hql_src_hql_lib_stdlib_stdlib_hql_zipmap as zipmap, get__Users_seoksoonjang_dev_hql_src_hql_lib_stdlib_stdlib_hql_get as get, getIn__Users_seoksoonjang_dev_hql_src_hql_lib_stdlib_stdlib_hql_getIn as getIn, assoc__Users_seoksoonjang_dev_hql_src_hql_lib_stdlib_stdlib_hql_assoc as assoc, assocIn__Users_seoksoonjang_dev_hql_src_hql_lib_stdlib_stdlib_hql_assocIn as assocIn, dissoc__Users_seoksoonjang_dev_hql_src_hql_lib_stdlib_stdlib_hql_dissoc as dissoc, update__Users_seoksoonjang_dev_hql_src_hql_lib_stdlib_stdlib_hql_update as update, updateIn__Users_seoksoonjang_dev_hql_src_hql_lib_stdlib_stdlib_hql_updateIn as updateIn, merge__Users_seoksoonjang_dev_hql_src_hql_lib_stdlib_stdlib_hql_merge as merge, throwEmptyTypeError__Users_seoksoonjang_dev_hql_src_hql_lib_stdlib_stdlib_hql_throwEmptyTypeError as throwEmptyTypeError, empty__Users_seoksoonjang_dev_hql_src_hql_lib_stdlib_stdlib_hql_empty as empty, conj__Users_seoksoonjang_dev_hql_src_hql_lib_stdlib_stdlib_hql_conj as conj, into__Users_seoksoonjang_dev_hql_src_hql_lib_stdlib_stdlib_hql_into as into, vec__Users_seoksoonjang_dev_hql_src_hql_lib_stdlib_stdlib_hql_vec as vec, set__Users_seoksoonjang_dev_hql_src_hql_lib_stdlib_stdlib_hql_set as set, doall__Users_seoksoonjang_dev_hql_src_hql_lib_stdlib_stdlib_hql_doall as doall, comp__Users_seoksoonjang_dev_hql_src_hql_lib_stdlib_stdlib_hql_comp as comp, partial__Users_seoksoonjang_dev_hql_src_hql_lib_stdlib_stdlib_hql_partial as partial, apply__Users_seoksoonjang_dev_hql_src_hql_lib_stdlib_stdlib_hql_apply as apply, sort__Users_seoksoonjang_dev_hql_src_hql_lib_stdlib_stdlib_hql_sort as sort, sortBy__Users_seoksoonjang_dev_hql_src_hql_lib_stdlib_stdlib_hql_sortBy as sortBy, mapT__Users_seoksoonjang_dev_hql_src_hql_lib_stdlib_stdlib_hql_mapT as mapT, filterT__Users_seoksoonjang_dev_hql_src_hql_lib_stdlib_stdlib_hql_filterT as filterT, takeT__Users_seoksoonjang_dev_hql_src_hql_lib_stdlib_stdlib_hql_takeT as takeT, dropT__Users_seoksoonjang_dev_hql_src_hql_lib_stdlib_stdlib_hql_dropT as dropT, takeWhileT__Users_seoksoonjang_dev_hql_src_hql_lib_stdlib_stdlib_hql_takeWhileT as takeWhileT, dropWhileT__Users_seoksoonjang_dev_hql_src_hql_lib_stdlib_stdlib_hql_dropWhileT as dropWhileT, distinctT__Users_seoksoonjang_dev_hql_src_hql_lib_stdlib_stdlib_hql_distinctT as distinctT, partitionAllT__Users_seoksoonjang_dev_hql_src_hql_lib_stdlib_stdlib_hql_partitionAllT as partitionAllT, composeTransducers__Users_seoksoonjang_dev_hql_src_hql_lib_stdlib_stdlib_hql_composeTransducers as composeTransducers, frequencies__Users_seoksoonjang_dev_hql_src_hql_lib_stdlib_stdlib_hql_frequencies as frequencies, selectKeys__Users_seoksoonjang_dev_hql_src_hql_lib_stdlib_stdlib_hql_selectKeys as selectKeys, mergeWith__Users_seoksoonjang_dev_hql_src_hql_lib_stdlib_stdlib_hql_mergeWith as mergeWith, remove__Users_seoksoonjang_dev_hql_src_hql_lib_stdlib_stdlib_hql_remove as remove, complement__Users_seoksoonjang_dev_hql_src_hql_lib_stdlib_stdlib_hql_complement as complement, memoize__Users_seoksoonjang_dev_hql_src_hql_lib_stdlib_stdlib_hql_memoize as memoize, notEmpty__Users_seoksoonjang_dev_hql_src_hql_lib_stdlib_stdlib_hql_notEmpty as notEmpty, boundedCount__Users_seoksoonjang_dev_hql_src_hql_lib_stdlib_stdlib_hql_boundedCount as boundedCount, runBang__Users_seoksoonjang_dev_hql_src_hql_lib_stdlib_stdlib_hql_runBang as runBang, everyPred__Users_seoksoonjang_dev_hql_src_hql_lib_stdlib_stdlib_hql_everyPred as everyPred, someFn__Users_seoksoonjang_dev_hql_src_hql_lib_stdlib_stdlib_hql_someFn as someFn, cat__Users_seoksoonjang_dev_hql_src_hql_lib_stdlib_stdlib_hql_cat as cat, dedupe__Users_seoksoonjang_dev_hql_src_hql_lib_stdlib_stdlib_hql_dedupe as dedupe, removeT__Users_seoksoonjang_dev_hql_src_hql_lib_stdlib_stdlib_hql_removeT as removeT, keepT__Users_seoksoonjang_dev_hql_src_hql_lib_stdlib_stdlib_hql_keepT as keepT, min__Users_seoksoonjang_dev_hql_src_hql_lib_stdlib_stdlib_hql_min as min, max__Users_seoksoonjang_dev_hql_src_hql_lib_stdlib_stdlib_hql_max as max, fnil__Users_seoksoonjang_dev_hql_src_hql_lib_stdlib_stdlib_hql_fnil as fnil, trampoline__Users_seoksoonjang_dev_hql_src_hql_lib_stdlib_stdlib_hql_trampoline as trampoline, strJoin__Users_seoksoonjang_dev_hql_src_hql_lib_stdlib_stdlib_hql_strJoin as strJoin, split__Users_seoksoonjang_dev_hql_src_hql_lib_stdlib_stdlib_hql_split as split, replace___Users_seoksoonjang_dev_hql_src_hql_lib_stdlib_stdlib_hql_replace as replace, trim__Users_seoksoonjang_dev_hql_src_hql_lib_stdlib_stdlib_hql_trim as trim, upperCase__Users_seoksoonjang_dev_hql_src_hql_lib_stdlib_stdlib_hql_upperCase as upperCase, lowerCase__Users_seoksoonjang_dev_hql_src_hql_lib_stdlib_stdlib_hql_lowerCase as lowerCase, startsWith__Users_seoksoonjang_dev_hql_src_hql_lib_stdlib_stdlib_hql_startsWith as startsWith, endsWith__Users_seoksoonjang_dev_hql_src_hql_lib_stdlib_stdlib_hql_endsWith as endsWith, includes__Users_seoksoonjang_dev_hql_src_hql_lib_stdlib_stdlib_hql_includes as includes, subs__Users_seoksoonjang_dev_hql_src_hql_lib_stdlib_stdlib_hql_subs as subs, isKeyword__Users_seoksoonjang_dev_hql_src_hql_lib_stdlib_stdlib_hql_isKeyword as isKeyword, isSymbol__Users_seoksoonjang_dev_hql_src_hql_lib_stdlib_stdlib_hql_isSymbol as isSymbol, isSeqable__Users_seoksoonjang_dev_hql_src_hql_lib_stdlib_stdlib_hql_isSeqable as isSeqable, isVector__Users_seoksoonjang_dev_hql_src_hql_lib_stdlib_stdlib_hql_isVector as isVector, isMap__Users_seoksoonjang_dev_hql_src_hql_lib_stdlib_stdlib_hql_isMap as isMap, isSet__Users_seoksoonjang_dev_hql_src_hql_lib_stdlib_stdlib_hql_isSet as isSet, isInt__Users_seoksoonjang_dev_hql_src_hql_lib_stdlib_stdlib_hql_isInt as isInt, isFloat__Users_seoksoonjang_dev_hql_src_hql_lib_stdlib_stdlib_hql_isFloat as isFloat, mapcatT__Users_seoksoonjang_dev_hql_src_hql_lib_stdlib_stdlib_hql_mapcatT as mapcatT };

// Public local aliases for self-hosted stdlib bindings
const take = take__Users_seoksoonjang_dev_hql_src_hql_lib_stdlib_stdlib_hql_take;
const drop = drop__Users_seoksoonjang_dev_hql_src_hql_lib_stdlib_stdlib_hql_drop;
const map = map__Users_seoksoonjang_dev_hql_src_hql_lib_stdlib_stdlib_hql_map;
const filter = filter__Users_seoksoonjang_dev_hql_src_hql_lib_stdlib_stdlib_hql_filter;
const reduce = reduce__Users_seoksoonjang_dev_hql_src_hql_lib_stdlib_stdlib_hql_reduce;
const concat = concat__Users_seoksoonjang_dev_hql_src_hql_lib_stdlib_stdlib_hql_concat;
const flatten = flatten__Users_seoksoonjang_dev_hql_src_hql_lib_stdlib_stdlib_hql_flatten;
const distinct = distinct__Users_seoksoonjang_dev_hql_src_hql_lib_stdlib_stdlib_hql_distinct;
const next = next__Users_seoksoonjang_dev_hql_src_hql_lib_stdlib_stdlib_hql_next;
const nth = nth__Users_seoksoonjang_dev_hql_src_hql_lib_stdlib_stdlib_hql_nth;
const second = second__Users_seoksoonjang_dev_hql_src_hql_lib_stdlib_stdlib_hql_second;
const count = count__Users_seoksoonjang_dev_hql_src_hql_lib_stdlib_stdlib_hql_count;
const last = last__Users_seoksoonjang_dev_hql_src_hql_lib_stdlib_stdlib_hql_last;
const mapIndexed = mapIndexed__Users_seoksoonjang_dev_hql_src_hql_lib_stdlib_stdlib_hql_mapIndexed;
const keepIndexed = keepIndexed__Users_seoksoonjang_dev_hql_src_hql_lib_stdlib_stdlib_hql_keepIndexed;
const mapcat = mapcat__Users_seoksoonjang_dev_hql_src_hql_lib_stdlib_stdlib_hql_mapcat;
const keep = keep__Users_seoksoonjang_dev_hql_src_hql_lib_stdlib_stdlib_hql_keep;
const takeWhile = takeWhile__Users_seoksoonjang_dev_hql_src_hql_lib_stdlib_stdlib_hql_takeWhile;
const dropWhile = dropWhile__Users_seoksoonjang_dev_hql_src_hql_lib_stdlib_stdlib_hql_dropWhile;
const splitWith = splitWith__Users_seoksoonjang_dev_hql_src_hql_lib_stdlib_stdlib_hql_splitWith;
const splitAt = splitAt__Users_seoksoonjang_dev_hql_src_hql_lib_stdlib_stdlib_hql_splitAt;
const reductions = reductions__Users_seoksoonjang_dev_hql_src_hql_lib_stdlib_stdlib_hql_reductions;
const interpose = interpose__Users_seoksoonjang_dev_hql_src_hql_lib_stdlib_stdlib_hql_interpose;
const interleave = interleave__Users_seoksoonjang_dev_hql_src_hql_lib_stdlib_stdlib_hql_interleave;
const partition = partition__Users_seoksoonjang_dev_hql_src_hql_lib_stdlib_stdlib_hql_partition;
const partitionAll = partitionAll__Users_seoksoonjang_dev_hql_src_hql_lib_stdlib_stdlib_hql_partitionAll;
const partitionBy = partitionBy__Users_seoksoonjang_dev_hql_src_hql_lib_stdlib_stdlib_hql_partitionBy;
const isEmpty = isEmpty__Users_seoksoonjang_dev_hql_src_hql_lib_stdlib_stdlib_hql_isEmpty;
const some = some__Users_seoksoonjang_dev_hql_src_hql_lib_stdlib_stdlib_hql_some;
const every = every__Users_seoksoonjang_dev_hql_src_hql_lib_stdlib_stdlib_hql_every;
const notAny = notAny__Users_seoksoonjang_dev_hql_src_hql_lib_stdlib_stdlib_hql_notAny;
const notEvery = notEvery__Users_seoksoonjang_dev_hql_src_hql_lib_stdlib_stdlib_hql_notEvery;
const isSome = isSome__Users_seoksoonjang_dev_hql_src_hql_lib_stdlib_stdlib_hql_isSome;
const isNil = isNil__Users_seoksoonjang_dev_hql_src_hql_lib_stdlib_stdlib_hql_isNil;
const isEven = isEven__Users_seoksoonjang_dev_hql_src_hql_lib_stdlib_stdlib_hql_isEven;
const isOdd = isOdd__Users_seoksoonjang_dev_hql_src_hql_lib_stdlib_stdlib_hql_isOdd;
const isZero = isZero__Users_seoksoonjang_dev_hql_src_hql_lib_stdlib_stdlib_hql_isZero;
const isPositive = isPositive__Users_seoksoonjang_dev_hql_src_hql_lib_stdlib_stdlib_hql_isPositive;
const isNegative = isNegative__Users_seoksoonjang_dev_hql_src_hql_lib_stdlib_stdlib_hql_isNegative;
const isNumber = isNumber__Users_seoksoonjang_dev_hql_src_hql_lib_stdlib_stdlib_hql_isNumber;
const isString = isString__Users_seoksoonjang_dev_hql_src_hql_lib_stdlib_stdlib_hql_isString;
const isBoolean = isBoolean__Users_seoksoonjang_dev_hql_src_hql_lib_stdlib_stdlib_hql_isBoolean;
const isFunction = isFunction__Users_seoksoonjang_dev_hql_src_hql_lib_stdlib_stdlib_hql_isFunction;
const isArray = isArray__Users_seoksoonjang_dev_hql_src_hql_lib_stdlib_stdlib_hql_isArray;
const isObject = isObject__Users_seoksoonjang_dev_hql_src_hql_lib_stdlib_stdlib_hql_isObject;
const isDelay = isDelay__Users_seoksoonjang_dev_hql_src_hql_lib_stdlib_stdlib_hql_isDelay;
const force = force__Users_seoksoonjang_dev_hql_src_hql_lib_stdlib_stdlib_hql_force;
const realized = realized__Users_seoksoonjang_dev_hql_src_hql_lib_stdlib_stdlib_hql_realized;
const inc = inc__Users_seoksoonjang_dev_hql_src_hql_lib_stdlib_stdlib_hql_inc;
const dec = dec__Users_seoksoonjang_dev_hql_src_hql_lib_stdlib_stdlib_hql_dec;
const abs = abs__Users_seoksoonjang_dev_hql_src_hql_lib_stdlib_stdlib_hql_abs;
const add = add__Users_seoksoonjang_dev_hql_src_hql_lib_stdlib_stdlib_hql_add;
const sub = sub__Users_seoksoonjang_dev_hql_src_hql_lib_stdlib_stdlib_hql_sub;
const mul = mul__Users_seoksoonjang_dev_hql_src_hql_lib_stdlib_stdlib_hql_mul;
const div = div__Users_seoksoonjang_dev_hql_src_hql_lib_stdlib_stdlib_hql_div;
const mod = mod__Users_seoksoonjang_dev_hql_src_hql_lib_stdlib_stdlib_hql_mod;
const eq = eq__Users_seoksoonjang_dev_hql_src_hql_lib_stdlib_stdlib_hql_eq;
const neq = neq__Users_seoksoonjang_dev_hql_src_hql_lib_stdlib_stdlib_hql_neq;
const deepEqInternal = deepEqInternal__Users_seoksoonjang_dev_hql_src_hql_lib_stdlib_stdlib_hql_deepEqInternal;
const deepEq = deepEq__Users_seoksoonjang_dev_hql_src_hql_lib_stdlib_stdlib_hql_deepEq;
const lt = lt__Users_seoksoonjang_dev_hql_src_hql_lib_stdlib_stdlib_hql_lt;
const gt = gt__Users_seoksoonjang_dev_hql_src_hql_lib_stdlib_stdlib_hql_gt;
const lte = lte__Users_seoksoonjang_dev_hql_src_hql_lib_stdlib_stdlib_hql_lte;
const gte = gte__Users_seoksoonjang_dev_hql_src_hql_lib_stdlib_stdlib_hql_gte;
const symbol = symbol__Users_seoksoonjang_dev_hql_src_hql_lib_stdlib_stdlib_hql_symbol;
const keyword = keyword__Users_seoksoonjang_dev_hql_src_hql_lib_stdlib_stdlib_hql_keyword;
const name = name__Users_seoksoonjang_dev_hql_src_hql_lib_stdlib_stdlib_hql_name;
const repeat = repeat__Users_seoksoonjang_dev_hql_src_hql_lib_stdlib_stdlib_hql_repeat;
const repeatedly = repeatedly__Users_seoksoonjang_dev_hql_src_hql_lib_stdlib_stdlib_hql_repeatedly;
const cycle = cycle__Users_seoksoonjang_dev_hql_src_hql_lib_stdlib_stdlib_hql_cycle;
const iterate = iterate__Users_seoksoonjang_dev_hql_src_hql_lib_stdlib_stdlib_hql_iterate;
const keys = keys__Users_seoksoonjang_dev_hql_src_hql_lib_stdlib_stdlib_hql_keys;
const groupBy = groupBy__Users_seoksoonjang_dev_hql_src_hql_lib_stdlib_stdlib_hql_groupBy;
const reverse = reverse__Users_seoksoonjang_dev_hql_src_hql_lib_stdlib_stdlib_hql_reverse;
const identity = identity__Users_seoksoonjang_dev_hql_src_hql_lib_stdlib_stdlib_hql_identity;
const constantly = constantly__Users_seoksoonjang_dev_hql_src_hql_lib_stdlib_stdlib_hql_constantly;
const vals = vals__Users_seoksoonjang_dev_hql_src_hql_lib_stdlib_stdlib_hql_vals;
const juxt = juxt__Users_seoksoonjang_dev_hql_src_hql_lib_stdlib_stdlib_hql_juxt;
const zipmap = zipmap__Users_seoksoonjang_dev_hql_src_hql_lib_stdlib_stdlib_hql_zipmap;
const get = get__Users_seoksoonjang_dev_hql_src_hql_lib_stdlib_stdlib_hql_get;
const getIn = getIn__Users_seoksoonjang_dev_hql_src_hql_lib_stdlib_stdlib_hql_getIn;
const assoc = assoc__Users_seoksoonjang_dev_hql_src_hql_lib_stdlib_stdlib_hql_assoc;
const assocIn = assocIn__Users_seoksoonjang_dev_hql_src_hql_lib_stdlib_stdlib_hql_assocIn;
const dissoc = dissoc__Users_seoksoonjang_dev_hql_src_hql_lib_stdlib_stdlib_hql_dissoc;
const update = update__Users_seoksoonjang_dev_hql_src_hql_lib_stdlib_stdlib_hql_update;
const updateIn = updateIn__Users_seoksoonjang_dev_hql_src_hql_lib_stdlib_stdlib_hql_updateIn;
const merge = merge__Users_seoksoonjang_dev_hql_src_hql_lib_stdlib_stdlib_hql_merge;
const throwEmptyTypeError = throwEmptyTypeError__Users_seoksoonjang_dev_hql_src_hql_lib_stdlib_stdlib_hql_throwEmptyTypeError;
const empty = empty__Users_seoksoonjang_dev_hql_src_hql_lib_stdlib_stdlib_hql_empty;
const conj = conj__Users_seoksoonjang_dev_hql_src_hql_lib_stdlib_stdlib_hql_conj;
const into = into__Users_seoksoonjang_dev_hql_src_hql_lib_stdlib_stdlib_hql_into;
const vec = vec__Users_seoksoonjang_dev_hql_src_hql_lib_stdlib_stdlib_hql_vec;
const set = set__Users_seoksoonjang_dev_hql_src_hql_lib_stdlib_stdlib_hql_set;
const doall = doall__Users_seoksoonjang_dev_hql_src_hql_lib_stdlib_stdlib_hql_doall;
const comp = comp__Users_seoksoonjang_dev_hql_src_hql_lib_stdlib_stdlib_hql_comp;
const partial = partial__Users_seoksoonjang_dev_hql_src_hql_lib_stdlib_stdlib_hql_partial;
const apply = apply__Users_seoksoonjang_dev_hql_src_hql_lib_stdlib_stdlib_hql_apply;
const sort = sort__Users_seoksoonjang_dev_hql_src_hql_lib_stdlib_stdlib_hql_sort;
const sortBy = sortBy__Users_seoksoonjang_dev_hql_src_hql_lib_stdlib_stdlib_hql_sortBy;
const mapT = mapT__Users_seoksoonjang_dev_hql_src_hql_lib_stdlib_stdlib_hql_mapT;
const filterT = filterT__Users_seoksoonjang_dev_hql_src_hql_lib_stdlib_stdlib_hql_filterT;
const takeT = takeT__Users_seoksoonjang_dev_hql_src_hql_lib_stdlib_stdlib_hql_takeT;
const dropT = dropT__Users_seoksoonjang_dev_hql_src_hql_lib_stdlib_stdlib_hql_dropT;
const takeWhileT = takeWhileT__Users_seoksoonjang_dev_hql_src_hql_lib_stdlib_stdlib_hql_takeWhileT;
const dropWhileT = dropWhileT__Users_seoksoonjang_dev_hql_src_hql_lib_stdlib_stdlib_hql_dropWhileT;
const distinctT = distinctT__Users_seoksoonjang_dev_hql_src_hql_lib_stdlib_stdlib_hql_distinctT;
const partitionAllT = partitionAllT__Users_seoksoonjang_dev_hql_src_hql_lib_stdlib_stdlib_hql_partitionAllT;
const composeTransducers = composeTransducers__Users_seoksoonjang_dev_hql_src_hql_lib_stdlib_stdlib_hql_composeTransducers;
const frequencies = frequencies__Users_seoksoonjang_dev_hql_src_hql_lib_stdlib_stdlib_hql_frequencies;
const selectKeys = selectKeys__Users_seoksoonjang_dev_hql_src_hql_lib_stdlib_stdlib_hql_selectKeys;
const mergeWith = mergeWith__Users_seoksoonjang_dev_hql_src_hql_lib_stdlib_stdlib_hql_mergeWith;
const remove = remove__Users_seoksoonjang_dev_hql_src_hql_lib_stdlib_stdlib_hql_remove;
const complement = complement__Users_seoksoonjang_dev_hql_src_hql_lib_stdlib_stdlib_hql_complement;
const memoize = memoize__Users_seoksoonjang_dev_hql_src_hql_lib_stdlib_stdlib_hql_memoize;
const notEmpty = notEmpty__Users_seoksoonjang_dev_hql_src_hql_lib_stdlib_stdlib_hql_notEmpty;
const boundedCount = boundedCount__Users_seoksoonjang_dev_hql_src_hql_lib_stdlib_stdlib_hql_boundedCount;
const runBang = runBang__Users_seoksoonjang_dev_hql_src_hql_lib_stdlib_stdlib_hql_runBang;
const everyPred = everyPred__Users_seoksoonjang_dev_hql_src_hql_lib_stdlib_stdlib_hql_everyPred;
const someFn = someFn__Users_seoksoonjang_dev_hql_src_hql_lib_stdlib_stdlib_hql_someFn;
const cat = cat__Users_seoksoonjang_dev_hql_src_hql_lib_stdlib_stdlib_hql_cat;
const dedupe = dedupe__Users_seoksoonjang_dev_hql_src_hql_lib_stdlib_stdlib_hql_dedupe;
const removeT = removeT__Users_seoksoonjang_dev_hql_src_hql_lib_stdlib_stdlib_hql_removeT;
const keepT = keepT__Users_seoksoonjang_dev_hql_src_hql_lib_stdlib_stdlib_hql_keepT;
const min = min__Users_seoksoonjang_dev_hql_src_hql_lib_stdlib_stdlib_hql_min;
const max = max__Users_seoksoonjang_dev_hql_src_hql_lib_stdlib_stdlib_hql_max;
const fnil = fnil__Users_seoksoonjang_dev_hql_src_hql_lib_stdlib_stdlib_hql_fnil;
const trampoline = trampoline__Users_seoksoonjang_dev_hql_src_hql_lib_stdlib_stdlib_hql_trampoline;
const strJoin = strJoin__Users_seoksoonjang_dev_hql_src_hql_lib_stdlib_stdlib_hql_strJoin;
const split = split__Users_seoksoonjang_dev_hql_src_hql_lib_stdlib_stdlib_hql_split;
const replace = replace___Users_seoksoonjang_dev_hql_src_hql_lib_stdlib_stdlib_hql_replace;
const trim = trim__Users_seoksoonjang_dev_hql_src_hql_lib_stdlib_stdlib_hql_trim;
const upperCase = upperCase__Users_seoksoonjang_dev_hql_src_hql_lib_stdlib_stdlib_hql_upperCase;
const lowerCase = lowerCase__Users_seoksoonjang_dev_hql_src_hql_lib_stdlib_stdlib_hql_lowerCase;
const startsWith = startsWith__Users_seoksoonjang_dev_hql_src_hql_lib_stdlib_stdlib_hql_startsWith;
const endsWith = endsWith__Users_seoksoonjang_dev_hql_src_hql_lib_stdlib_stdlib_hql_endsWith;
const includes = includes__Users_seoksoonjang_dev_hql_src_hql_lib_stdlib_stdlib_hql_includes;
const subs = subs__Users_seoksoonjang_dev_hql_src_hql_lib_stdlib_stdlib_hql_subs;
const isKeyword = isKeyword__Users_seoksoonjang_dev_hql_src_hql_lib_stdlib_stdlib_hql_isKeyword;
const isSymbol = isSymbol__Users_seoksoonjang_dev_hql_src_hql_lib_stdlib_stdlib_hql_isSymbol;
const isSeqable = isSeqable__Users_seoksoonjang_dev_hql_src_hql_lib_stdlib_stdlib_hql_isSeqable;
const isVector = isVector__Users_seoksoonjang_dev_hql_src_hql_lib_stdlib_stdlib_hql_isVector;
const isMap = isMap__Users_seoksoonjang_dev_hql_src_hql_lib_stdlib_stdlib_hql_isMap;
const isSet = isSet__Users_seoksoonjang_dev_hql_src_hql_lib_stdlib_stdlib_hql_isSet;
const isInt = isInt__Users_seoksoonjang_dev_hql_src_hql_lib_stdlib_stdlib_hql_isInt;
const isFloat = isFloat__Users_seoksoonjang_dev_hql_src_hql_lib_stdlib_stdlib_hql_isFloat;
const mapcatT = mapcatT__Users_seoksoonjang_dev_hql_src_hql_lib_stdlib_stdlib_hql_mapcatT;

// Lisp-style predicate aliases (with ? suffix)
// These map `nil?` -> `nil_QMARK_` via sanitizeIdentifier
export { isNil__Users_seoksoonjang_dev_hql_src_hql_lib_stdlib_stdlib_hql_isNil as nil_QMARK_ };
export { isNumber__Users_seoksoonjang_dev_hql_src_hql_lib_stdlib_stdlib_hql_isNumber as number_QMARK_ };
export { isString__Users_seoksoonjang_dev_hql_src_hql_lib_stdlib_stdlib_hql_isString as string_QMARK_ };
export { isBoolean__Users_seoksoonjang_dev_hql_src_hql_lib_stdlib_stdlib_hql_isBoolean as boolean_QMARK_ };
export { isArray__Users_seoksoonjang_dev_hql_src_hql_lib_stdlib_stdlib_hql_isArray as array_QMARK_ };
export { isObject__Users_seoksoonjang_dev_hql_src_hql_lib_stdlib_stdlib_hql_isObject as object_QMARK_ };
export { isFunction__Users_seoksoonjang_dev_hql_src_hql_lib_stdlib_stdlib_hql_isFunction as fn_QMARK_ };
export { isEmpty__Users_seoksoonjang_dev_hql_src_hql_lib_stdlib_stdlib_hql_isEmpty as empty_QMARK_ };
export { isZero__Users_seoksoonjang_dev_hql_src_hql_lib_stdlib_stdlib_hql_isZero as zero_QMARK_ };
export { isEven__Users_seoksoonjang_dev_hql_src_hql_lib_stdlib_stdlib_hql_isEven as even_QMARK_ };
export { isOdd__Users_seoksoonjang_dev_hql_src_hql_lib_stdlib_stdlib_hql_isOdd as odd_QMARK_ };
export { isPositive__Users_seoksoonjang_dev_hql_src_hql_lib_stdlib_stdlib_hql_isPositive as pos_QMARK_ };
export { isNegative__Users_seoksoonjang_dev_hql_src_hql_lib_stdlib_stdlib_hql_isNegative as neg_QMARK_ };
export { every__Users_seoksoonjang_dev_hql_src_hql_lib_stdlib_stdlib_hql_every as every_QMARK_ };
export { some__Users_seoksoonjang_dev_hql_src_hql_lib_stdlib_stdlib_hql_some as some_QMARK_ };
