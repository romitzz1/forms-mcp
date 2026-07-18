# Changelog

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
