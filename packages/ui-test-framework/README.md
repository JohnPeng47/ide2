# UI Test Framework

Development-only React wrapper for exposing implementation variants through a
floating control dial. The package has one public runtime export:
`UiTestFramework`.

Controls are declared at the development composition boundary. Wrapped product
components receive only plain values and never import this package directly.
