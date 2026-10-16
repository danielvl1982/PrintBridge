# F6 - Run the interactive .NET sample printing client

Ticket: sin ticket (internal development)

## Purpose

The interactive .NET console sample connects to the local PrintBridge agent, lists installed printers, and sends either a built-in printer-language label or a PNG file to print (`dotnet/PrintBridge.Sample/Program.cs:4-28`, `dotnet/PrintBridge.Sample/PrintBridgeClient.cs:21-36`). The sample is intentionally local-only and is not to be versioned or distributed; this is the resolved decision recorded in [open question 29](../preguntas-abiertas.md). The repository records the sample as git-ignored and not versioned (`.gitignore:30-31`; `openspec/config.yaml:16-20`), with its local project configuration at `dotnet/PrintBridge.Sample/PrintBridge.Sample.csproj:1-10`.

## Trigger / Entry point

- Run `dotnet run [-- <agent-url>]` from the sample project; the optional URL overrides the default `http://127.0.0.1:9631` (`dotnet/PrintBridge.Sample/Program.cs:3-5`).

## Inputs (payload/config)

- Optional agent base URL; default is `http://127.0.0.1:9631`. The client timeout is 90 seconds (`dotnet/PrintBridge.Sample/Program.cs:3-5`).
- Printer and mode are selected from numbered console choices; the available modes are RAW printer-language text and Driver PNG image (`dotnet/PrintBridge.Sample/Program.cs:12-13`, `51-60`).
- Copies are parsed as an integer from 1 through 99; missing or invalid input falls back to 1 (`dotnet/PrintBridge.Sample/Program.cs:14`).
- RAW mode asks for TPCL, TSPL, or ZPL and uses the corresponding built-in label (`dotnet/PrintBridge.Sample/Program.cs:16-19`; `dotnet/PrintBridge.Sample/SampleLabels.cs:3-10`).
- Driver mode asks for a PNG path, width and height in millimeters, and DPI. A missing file exits with code 1; invalid or non-positive dimensions and DPI fall back to 100 × 60 mm and 203 DPI (`dotnet/PrintBridge.Sample/Program.cs:21-28`).

## Steps

1. The program uses the first argument as the agent URL or the local default, creates an HTTP client with a 90-second timeout, and requests the printer list (`dotnet/PrintBridge.Sample/Program.cs:3-9`; `dotnet/PrintBridge.Sample/PrintBridgeClient.cs:21-25`).
2. If no printers are returned, it prints a message and exits with code 1; otherwise the user selects a printer, mode, and copy count (`dotnet/PrintBridge.Sample/Program.cs:10-14`).
3. In RAW mode, the user selects a built-in TPCL, TSPL, or ZPL label, which is UTF-8 encoded and posted to `/print` as `application/octet-stream` with the printer and copy count in the query (`dotnet/PrintBridge.Sample/Program.cs:16-19`; `dotnet/PrintBridge.Sample/PrintBridgeClient.cs:27-29`; `dotnet/PrintBridge.Sample/SampleLabels.cs:6-10`).
4. In Driver mode, the program reads the selected PNG and posts it to `/print-image` as `image/png`, with printer, dimensions, DPI, copies, and `paper=label` in the query; numeric query values use invariant culture (`dotnet/PrintBridge.Sample/Program.cs:21-28`; `dotnet/PrintBridge.Sample/PrintBridgeClient.cs:31-36`).
5. For non-success print responses, the client reads the agent error and message and throws `PrintBridgeException`; successful completion prints the selected printer (`dotnet/PrintBridge.Sample/PrintBridgeClient.cs:46-52`; `dotnet/PrintBridge.Sample/Program.cs:31-37`).

## Exit points

| Output | Detail |
|---|---|
| Local printer agent HTTP API | Reads `GET /printers`; writes `POST /print` in RAW mode or `POST /print-image` in Driver mode (`dotnet/PrintBridge.Sample/PrintBridgeClient.cs:21-36`). These paths correspond to [F5](select-printer.md), [F3](print-raw-label.md), and [F4](print-label-image.md). |
| Console and process exit | Prints the selected printer on success (code 0), no-printer or missing-file messages (code 1), agent error details (code 2), or connection guidance (code 3) (`dotnet/PrintBridge.Sample/Program.cs:10`, `24`, `31-43`). |

## Business rules

- The printer chooser accepts only a listed one-based item number and repeats the prompt for invalid choices (`dotnet/PrintBridge.Sample/Program.cs:51-60`).
- Invalid copy input defaults to 1; parsed values outside 1-99 also default to 1 (`dotnet/PrintBridge.Sample/Program.cs:14`).
- RAW mode sends the chosen built-in label; Driver mode requires an existing PNG and defaults invalid/non-positive dimensions and DPI to 100 × 60 mm and 203 DPI (`dotnet/PrintBridge.Sample/Program.cs:16-28`; `dotnet/PrintBridge.Sample/SampleLabels.cs:6-10`).
- RAW payload text is UTF-8 encoded, while image query dimensions are formatted with invariant culture (`dotnet/PrintBridge.Sample/PrintBridgeClient.cs:27-36`).

## Errors and edge cases

- An empty printer list prints `The agent reports no printers.` and returns 1 (`dotnet/PrintBridge.Sample/Program.cs:9-10`).
- A missing PNG prints `File not found.` and returns 1 (`dotnet/PrintBridge.Sample/Program.cs:23-24`).
- A non-success POST response becomes a `PrintBridgeException`; the program prints its code and message and returns 2 (`dotnet/PrintBridge.Sample/PrintBridgeClient.cs:46-52`; `dotnet/PrintBridge.Sample/Program.cs:34-37`).
- An `HttpRequestException` prints the agent URL and startup guidance, then returns 3 (`dotnet/PrintBridge.Sample/Program.cs:39-43`).
- Invalid menu input repeats until a valid one-based choice is entered (`dotnet/PrintBridge.Sample/Program.cs:55-59`).

## Where to act

| If changing... | Start at |
|---|---|
| Input validation | `dotnet/PrintBridge.Sample/Program.cs` → `Ask` and `Choose` (`dotnet/PrintBridge.Sample/Program.cs:45-60`), plus mode-specific parsing (`dotnet/PrintBridge.Sample/Program.cs:14`, `23-28`). |
| Printer selection / query | `dotnet/PrintBridge.Sample/Program.cs` → `Choose`; `dotnet/PrintBridge.Sample/PrintBridgeClient.cs` → `GetPrintersAsync` (`dotnet/PrintBridge.Sample/Program.cs:9-13`; `dotnet/PrintBridge.Sample/PrintBridgeClient.cs:21-25`). |
| Business rules / mode behavior | `dotnet/PrintBridge.Sample/Program.cs` → top-level RAW/Driver branch (`dotnet/PrintBridge.Sample/Program.cs:14-28`). |
| Output / persistence | `dotnet/PrintBridge.Sample/PrintBridgeClient.cs` → `PrintRawAsync`, `PrintImageAsync`, and `PostAsync` (`dotnet/PrintBridge.Sample/PrintBridgeClient.cs:27-52`); this client has no local persistence (`dotnet/PrintBridge.Sample/Program.cs:3-43`). |
| Scheduling / configuration | No scheduled work is present; agent URL and request timeout are configured when the client is created (`dotnet/PrintBridge.Sample/Program.cs:3-5`). |

## Existing tests

- No .NET test project or direct tests for this sample client were found in the current local checkout; the sample project is an executable targeting `net10.0` (`dotnet/PrintBridge.Sample/PrintBridge.Sample.csproj:1-10`).

## Coverage / Gaps

- The sample is intentionally local-only and is not to be versioned or distributed; see [resolved question 29](../preguntas-abiertas.md) (`.gitignore:30-31`; `openspec/config.yaml:16-20`).
- No direct automated coverage for the sample's console flow or HTTP client was found. See [open question 5](../preguntas-abiertas.md).
