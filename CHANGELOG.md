# Changelog

## [2.0.0](https://github.com/romitzz1/forms-mcp/compare/gravity-forms-mcp-server-v1.1.0...gravity-forms-mcp-server-v2.0.0) (2026-10-14)


### ⚠ BREAKING CHANGES

* update export/import schemas and add get_export_link schema
* render exports without disk writes or base64; harden CSV and use UTC filenames

### Features

* add filesystem export store with atomic saves and retention sweep ([af091df](https://github.com/romitzz1/forms-mcp/commit/af091df1094a82f95a999cc8d6486a7bb0ff9a11))
* add HMAC-signed export download links ([3942801](https://github.com/romitzz1/forms-mcp/commit/3942801937c3ad4f3da67fd9625c0372cd839653))
* add shared export result builder with capped previews ([1c62fa7](https://github.com/romitzz1/forms-mcp/commit/1c62fa7d382fc20c6541fa5e0bf7c3d77ccccd63))
* allow import_form_json to import from an export by id ([a11491b](https://github.com/romitzz1/forms-mcp/commit/a11491bcc647b64e250c6d4436537322c8de6149))
* parse export configuration with safe fallbacks ([f850460](https://github.com/romitzz1/forms-mcp/commit/f85046022da8c7a02907a49b10c8d4499cc8587e))
* render exports without disk writes or base64; harden CSV and use UTC filenames ([756a87b](https://github.com/romitzz1/forms-mcp/commit/756a87bc93373f44f73a2768d3dad89e3cd89001))
* save exports to the store and add get_export_link handler ([2a52004](https://github.com/romitzz1/forms-mcp/commit/2a52004dd8ea11f4556b3ef48f2fb5460324dc10))
* serve exports through signed download links ([d570b3e](https://github.com/romitzz1/forms-mcp/commit/d570b3ea7aaece849707bb52ebb6fbcb34007d38))
* update export/import schemas and add get_export_link schema ([4bdfb3f](https://github.com/romitzz1/forms-mcp/commit/4bdfb3f5454afd6292ed6a19ce78243d75c7c96f))
* wire export store, gf-export resource, and retention sweep into the server ([9a0c6d8](https://github.com/romitzz1/forms-mcp/commit/9a0c6d8508d04ed6a8695b70c7da948f0bd955f7))


### Bug Fixes

* close export file handle when the client disconnects early ([959e4d4](https://github.com/romitzz1/forms-mcp/commit/959e4d4a34faf54e6d685b2fd05f4d698916fc24))
* harden export store startup against legacy scan and timer leaks ([23801bf](https://github.com/romitzz1/forms-mcp/commit/23801bf4eb911a028fece4b429b48916f632c6a2))


### Documentation

* correct DataExporter and MCP_PUBLIC_BASE_URL descriptions ([5a04044](https://github.com/romitzz1/forms-mcp/commit/5a040447a2937a190e7588a8ac94faa34c982df7))
* correct export tool/config documentation drift ([381725a](https://github.com/romitzz1/forms-mcp/commit/381725a1455315e18200ac00dc6062c69c5973b9))
* describe export delivery, get_export_link, and legacy export cleanup ([9d05e8e](https://github.com/romitzz1/forms-mcp/commit/9d05e8e8c414c0499738682639321b9180d028d3))
* document export store configuration and download links ([0c1cb87](https://github.com/romitzz1/forms-mcp/commit/0c1cb87838f1e3aaf129ec53c493d7f2c61dd72a))


### Code Refactoring

* align new export types with naming conventions and clear lint warnings ([e204659](https://github.com/romitzz1/forms-mcp/commit/e204659a850637073c2e06ae64c6e0b75055dae2))

## [1.1.0](https://github.com/romitzz1/forms-mcp/compare/gravity-forms-mcp-server-v1.0.0...gravity-forms-mcp-server-v1.1.0) (2026-07-18)


### Features

* add get_server_info tool and single-source the advertised version ([8b9f376](https://github.com/romitzz1/forms-mcp/commit/8b9f376ab69fa3486df679a76a8262e6afb9aa3d))
* add get_server_info tool and single-source the advertised version ([76abb36](https://github.com/romitzz1/forms-mcp/commit/76abb36b055c04095b797a4e343b40bd58fe5a29))


### Bug Fixes

* **cache:** classify DB errors platform-agnostically (tolerant of non-Error throws) ([9be08bb](https://github.com/romitzz1/forms-mcp/commit/9be08bb4f9389b1399a52a8ac1b69d16340e9e8d))
* **entries:** preserve original bare-truthy search guard in getEntries ([a23d62a](https://github.com/romitzz1/forms-mcp/commit/a23d62a7f92ad6165656e31fbc8dbad7c81334e8))
* **import:** preserve throw on invalid conditionalLogic rules; correct edge-case disclosures ([00e593d](https://github.com/romitzz1/forms-mcp/commit/00e593dcada4294283897edda06d1ae3240e629d))
* preserve all populated fields in get_entries summary mode ([fb906c4](https://github.com/romitzz1/forms-mcp/commit/fb906c4c3f7e44ac7e21b111aea43c9c1825b68a))
* preserve all populated fields in get_entries summary mode ([9664699](https://github.com/romitzz1/forms-mcp/commit/9664699761e2bccb2667b937a3c76b2947af9414))
* **search:** preserve max_results:0 and maxSize:0 fallback behavior ([8e2d350](https://github.com/romitzz1/forms-mcp/commit/8e2d3505850042e62c9198b0f954ed7e38085627))


### Documentation

* document get_server_info and update tool count to 22 ([68342c7](https://github.com/romitzz1/forms-mcp/commit/68342c7de9afebcf712d9be97dace9c7fbec18f9))


### Code Refactoring

* **types:** add canonical GF domain types and generic makeRequest boundary ([eddfb58](https://github.com/romitzz1/forms-mcp/commit/eddfb58ab52d6669f3cb0169900d1ecd78bda650))
* **types:** eliminate production any-warnings; restore strict lint gate ([a8f8ff7](https://github.com/romitzz1/forms-mcp/commit/a8f8ff7f02f20d67b8a25e3650219b83654994a6))
* **types:** type bulk/export tool handlers; prod warnings now zero ([0a47e1d](https://github.com/romitzz1/forms-mcp/commit/0a47e1d50bf0f988a91591f194c49bdff87ec4c2))
* **types:** type entries-query, aggregate, and validation ([edd8f00](https://github.com/romitzz1/forms-mcp/commit/edd8f00d3589fda81c381064de4b3c782a4188cb))
* **types:** type FormCache and database layer ([d8f8551](https://github.com/romitzz1/forms-mcp/commit/d8f855176fc24777052a953a39b915524d59748b))
* **types:** type forms/entry/field-mapping tool handlers ([3908be3](https://github.com/romitzz1/forms-mcp/commit/3908be33fb9ddeb367a3be33e34e824281ea4e4b))
* **types:** type server dispatch, response sizing, template/cache tools ([f0d1479](https://github.com/romitzz1/forms-mcp/commit/f0d1479bd3945a2d6f57dadad8d6b9ae029d522b))
* **types:** type the export/import/template stack ([343bec9](https://github.com/romitzz1/forms-mcp/commit/343bec98012d0a16e9c68e78be8b3764e68f3bc6))
* **types:** type the search stack, remove any usage ([fa96b50](https://github.com/romitzz1/forms-mcp/commit/fa96b505d31650e04f22ebc75dedae2c3ef41a6d))
