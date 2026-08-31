const TABLER_PACKAGE = '@tabler/icons-react'
const TABLER_ICON_PATH = '@tabler/icons-react/dist/esm/icons'

type BabelIdentifier = {
  type: 'Identifier'
  name: string
}

type BabelStringLiteral = {
  type: 'StringLiteral'
  value: string
}

type BabelImportSpecifier = {
  type: 'ImportSpecifier'
  imported: BabelIdentifier | BabelStringLiteral
  local: BabelIdentifier
  importKind?: 'type' | 'value' | null
}

type BabelImportDeclaration = {
  type: 'ImportDeclaration'
  source: BabelStringLiteral
  specifiers: unknown[]
  importKind?: 'type' | 'value' | null
}

type BabelTypes = {
  isIdentifier: (node: unknown) => node is BabelIdentifier
  isImportSpecifier: (node: unknown) => node is BabelImportSpecifier
  isStringLiteral: (node: unknown) => node is BabelStringLiteral
  importDeclaration: (specifiers: unknown[], source: BabelStringLiteral) => BabelImportDeclaration
  importDefaultSpecifier: (local: BabelIdentifier) => unknown
  stringLiteral: (value: string) => BabelStringLiteral
}

type BabelPluginApi = {
  types: BabelTypes
}

type BabelImportDeclarationPath = {
  node: BabelImportDeclaration
  replaceWithMultiple: (nodes: BabelImportDeclaration[]) => void
}

type BabelPlugin = {
  name: string
  visitor: {
    ImportDeclaration: (path: BabelImportDeclarationPath) => void
  }
}

function readImportedName(types: BabelTypes, specifier: BabelImportSpecifier): string {
  if (types.isIdentifier(specifier.imported)) return specifier.imported.name
  if (types.isStringLiteral(specifier.imported)) return specifier.imported.value
  throw new Error('Unsupported Tabler icon import name')
}

export function tablerDirectImports({ types }: BabelPluginApi): BabelPlugin {
  return {
    name: 'tapcanvas-tabler-direct-imports',
    visitor: {
      ImportDeclaration(path): void {
        const declaration = path.node
        if (declaration.source.value !== TABLER_PACKAGE) return

        const directImports: BabelImportDeclaration[] = []

        for (const candidate of declaration.specifiers) {
          if (!types.isImportSpecifier(candidate)) {
            throw new Error('Tabler imports must use named imports')
          }
          const isTypeImport = declaration.importKind === 'type' || candidate.importKind === 'type'
          if (isTypeImport) continue

          const importedName = readImportedName(types, candidate)
          directImports.push(types.importDeclaration(
            [types.importDefaultSpecifier(candidate.local)],
            types.stringLiteral(`${TABLER_ICON_PATH}/${importedName}.mjs`),
          ))
        }

        path.replaceWithMultiple(directImports)
      },
    },
  }
}
