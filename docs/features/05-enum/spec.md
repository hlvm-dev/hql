# HQL Enumerations Specification

## 1. Goal

Define type-safe enumerations (groups of named constants) with Lisp-native syntax. Supports dot-notation access (`OsType.macOS`) and shorthand access (`.macOS`) via syntax transformer resolution.

## 2. Implementation

Implemented as a core compiler feature. The `(enum ...)` S-expression is recognized by the parser, transformed to `IREnumDeclaration` nodes in the IR, and code-generated to JavaScript.

- **Parsing:** `src/hql/transpiler/syntax/enum.ts` — `transformEnumDeclaration` and `parseEnumCase`
- **IR types:** `IREnumDeclaration`, `IREnumCase`, `IREnumAssociatedValue` in `hql_ir.ts`
- **Codegen:** `ir-to-typescript.ts` — `generateEnumDeclaration`, `generateSimpleEnum`, `generateEnumWithAssociatedValues`
- **Dot shorthand:** `syntax-transformer.ts` — `transformDotNotationSymbol`

## 3. Declaration Syntax

```hql
;; Simple enum
(enum OsType
  (case macOS)
  (case windowOS)
  (case linux))

;; Enum with raw values
(enum StatusCodes
  (case ok 200)
  (case notFound 404))

;; Enum with associated values
(enum Barcode
  (case upc system manufacturer product check)
  (case qrCode value))

;; Optional raw type annotation (colon or separate token)
(enum HttpStatus:Int
  (case ok 200)
  (case notFound 404))
```

## 4. Usage

```hql
;; Access simple case
(let currentOS OsType.macOS)

;; Compare
(if (=== currentOS OsType.linux) (print "Linux!"))

;; Access raw value directly
(let status StatusCodes.notFound)  ;; => 404

;; Create associated value instance
(let code (Barcode.qrCode "hql-data"))

;; Check type
(code.is "qrCode")  ;; => true

;; Access associated values
(get code.values "value")  ;; => "hql-data"
```

## 5. Dot Notation Shorthand

The syntax transformer resolves `.caseName` to `EnumName.caseName` by scanning known enum definitions:

```hql
(enum OS
  (case macOS)
  (case iOS)
  (case linux))

(fn install [os]
  (cond
    ((=== os .macOS) (print "Installing on macOS"))
    ((=== os .iOS)   (print "Installing on iOS"))
    ((=== os .linux) (print "Installing on Linux"))
    (else            (print "Unsupported OS"))))
```

Resolution occurs at the syntax transformer stage before IR generation. If no matching enum case is found, the symbol is left unchanged.

## 6. Compiled Output

### Simple / Raw Value Enums

```js
const Direction = Object.freeze({
  north: "north",
  south: "south",
  east: "east",
  west: "west"
});
```

### Enums with Associated Values

```js
class Payment {
  type;
  values;
  constructor(type, values) {
    this.type = type;
    this.values = values;
    Object.freeze(this);
  }
  is(type) {
    return this.type === type;
  }
  static cash(amount) {
    return new Payment("cash", { amount });
  }
  static creditCard(number, expiry) {
    return new Payment("creditCard", { number, expiry });
  }
}
```

## 7. IR Representation

```typescript
interface IREnumDeclaration {
  type: IRNodeType.EnumDeclaration;
  id: IRIdentifier;
  rawType?: string;          // optional type annotation
  cases: IREnumCase[];
  hasAssociatedValues?: boolean;
}

interface IREnumCase {
  type: IRNodeType.EnumCase;
  id: IRIdentifier;
  rawValue?: IRNode | null;
  associatedValues?: IREnumAssociatedValue[];
  hasAssociatedValues?: boolean;
}

interface IREnumAssociatedValue {
  name: string;
}
```
