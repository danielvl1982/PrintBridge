# dotnet-sample-print-client Specification

## Purpose

Baseline spec (current behavior, derived from code on 2026-10-16). The interactive local .NET sample retrieves installed printers and sends either a built-in RAW label or a PNG image to the local PrintBridge agent. Documentation: `docs/features/dotnet-sample-print-client.md`. Ticket: none (internal development). The sample is intentionally local-only: its source under `dotnet/` is Git-ignored and is neither versioned nor distributed (`.gitignore:30-31`; `git check-ignore` confirmed `dotnet/PrintBridge.Sample/Program.cs` is ignored).

## Requirements

### Requirement: Connect to the local agent and retrieve printers

The sample SHALL use the first command-line argument as the agent base URL, or `http://127.0.0.1:9631` when no argument is supplied, and SHALL configure a 90-second HTTP timeout (`dotnet/PrintBridge.Sample/Program.cs:3-5`). The client SHALL request `GET /printers` and treat a missing printer response/list as empty (`dotnet/PrintBridge.Sample/PrintBridgeClient.cs:21-25`).

#### Scenario: Use the default agent address
- GIVEN the sample starts without a URL argument
- WHEN it creates the HTTP client and requests printers
- THEN it SHALL use `http://127.0.0.1:9631`, a 90-second timeout, and `GET /printers`

#### Scenario: Override the agent address
- GIVEN the sample starts with an agent URL argument
- WHEN it creates the HTTP client
- THEN it SHALL use that argument as the base URL

### Requirement: Stop when the agent has no printers

The sample SHALL print `The agent reports no printers.` and return exit code 1 when the retrieved printer list is empty (`dotnet/PrintBridge.Sample/Program.cs:9-10`).

#### Scenario: Empty printer list
- GIVEN the agent returns no printers
- WHEN the sample checks the returned list
- THEN it SHALL print `The agent reports no printers.` and exit with code 1 without asking for a printer

### Requirement: Choose a listed printer, print mode, and copy count

The sample SHALL present the returned printers and the RAW and Driver modes as numbered choices, and SHALL repeat the choice prompt until the entered one-based number is within the list (`dotnet/PrintBridge.Sample/Program.cs:12-14`, `51-59`). It SHALL accept copy counts from 1 through 99 and use 1 for missing, unparsable, or out-of-range input (`dotnet/PrintBridge.Sample/Program.cs:14`).

#### Scenario: Reject an invalid menu number
- GIVEN a numbered printer or mode menu is displayed
- WHEN the user enters a number outside the listed one-based range or non-numeric input
- THEN the sample SHALL print `Invalid choice.` and ask again

#### Scenario: Default an invalid copy count
- GIVEN the sample asks for copies
- WHEN the input is missing, unparsable, less than 1, or greater than 99
- THEN the sample SHALL use 1 copy

### Requirement: Send built-in RAW printer-language labels

In RAW mode, the sample SHALL ask the user to choose TPCL, TSPL, or ZPL, use that language's built-in sample label, and call the client with the selected printer and copy count (`dotnet/PrintBridge.Sample/Program.cs:16-20`; `dotnet/PrintBridge.Sample/SampleLabels.cs:3-10`). The client SHALL UTF-8 encode the label, POST it to `/print` with the printer and copies in the query, and set the content type to `application/octet-stream` (`dotnet/PrintBridge.Sample/PrintBridgeClient.cs:27-29`, `39-44`).

#### Scenario: Print a built-in RAW label
- GIVEN the user selects RAW mode and one of TPCL, TSPL, or ZPL
- WHEN the sample submits the selected label
- THEN it SHALL send the corresponding built-in label as UTF-8 `application/octet-stream` to `/print` for the selected printer and copy count

### Requirement: Send a PNG through the printer driver

In Driver mode, the sample SHALL ask for a PNG path and return exit code 1 with `File not found.` if that file does not exist (`dotnet/PrintBridge.Sample/Program.cs:21-24`). It SHALL read an existing file, parse width and height using invariant culture and DPI as an integer, and substitute 100 mm, 60 mm, and 203 DPI respectively when the parsed values are not positive (`dotnet/PrintBridge.Sample/Program.cs:25-28`). The client SHALL POST the PNG to `/print-image` with `image/png`, the selected printer, dimensions, DPI, copies, and `paper=label`; dimensions SHALL use invariant-culture formatting (`dotnet/PrintBridge.Sample/PrintBridgeClient.cs:31-36`).

#### Scenario: Reject a missing PNG
- GIVEN the user selects Driver mode and supplies a path that does not exist
- WHEN the sample checks the path
- THEN it SHALL print `File not found.` and exit with code 1 without sending a request

#### Scenario: Send an existing PNG with defaults for invalid dimensions
- GIVEN the user supplies an existing PNG and non-positive or unparsable dimensions or DPI
- WHEN the sample submits the image
- THEN it SHALL use 100 mm width, 60 mm height, and 203 DPI for the invalid values and POST the PNG as `image/png` to `/print-image` with `paper=label`

### Requirement: Report a successful print

After either print request completes successfully, the sample SHALL print `Sent to "<printer>".` and return exit code 0 (`dotnet/PrintBridge.Sample/Program.cs:31-32`).

#### Scenario: Successful RAW or Driver print
- GIVEN the agent accepts the selected print request
- WHEN the request completes
- THEN the sample SHALL print the selected printer in the success message and exit with code 0

### Requirement: Report agent print errors

The client SHALL treat a successful HTTP status as success; for a non-success status it SHALL read the agent error response and throw `PrintBridgeException`, using `unknown` and `Unknown error` when the response omits the corresponding code or message (`dotnet/PrintBridge.Sample/PrintBridgeClient.cs:46-52`). The sample SHALL print the exception code and message and return exit code 2 (`dotnet/PrintBridge.Sample/Program.cs:34-37`).

#### Scenario: Agent rejects a print request
- GIVEN a print request receives a non-success HTTP response
- WHEN the client processes the response
- THEN it SHALL raise `PrintBridgeException` with the response error details or their documented fallbacks, and the sample SHALL print `Agent error [<code>]: <message>` and exit with code 2

### Requirement: Explain an unreachable agent

The sample SHALL catch `HttpRequestException`, print the configured agent URL with connection guidance to start `node agent/printbridge-agent.js`, and return exit code 3 (`dotnet/PrintBridge.Sample/Program.cs:39-43`).

#### Scenario: Agent connection fails
- GIVEN a request to the configured agent cannot be completed due to an HTTP request failure
- WHEN the exception reaches the sample's handler
- THEN it SHALL print the URL and startup guidance and exit with code 3
