# Security Policy

## Reporting a Vulnerability

Please report vulnerabilities privately via GitHub Security Advisories on this
repository. Do not open a public issue.

## Scope

crema is a streaming data-pipeline library with no embedded secrets and no
network listeners. Its network surface is outbound only (data.gov.au CKAN
discovery + downloads, with a browser User-Agent). Primary concern: supply chain
(dependencies, managed via dependabot).

## Supported Versions

| Version | Supported |
| ------- | --------- |
| latest  | Yes       |
