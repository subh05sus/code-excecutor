# C# runner (SparkMentis practical exams, 2026-10-20). One file is compiled
# with the SDK's own Roslyn compiler directly — about 2 s, where `dotnet build`
# of a project takes 10 s or more — and the dll runs on the shared runtime.
# Built by the executor when missing (LanguageConfig.build), so pruning it is safe.
FROM mcr.microsoft.com/dotnet/sdk:8.0-alpine
ENV DOTNET_CLI_TELEMETRY_OPTOUT=1 DOTNET_NOLOGO=1 DOTNET_SKIP_FIRST_TIME_EXPERIENCE=1 HOME=/tmp
COPY csc-compile /usr/local/bin/csc-compile
RUN chmod 755 /usr/local/bin/csc-compile \
 && RT=$(ls /usr/share/dotnet/shared/Microsoft.NETCore.App | sort -V | tail -n1) \
 && printf '{"runtimeOptions":{"tfm":"net8.0","framework":{"name":"Microsoft.NETCore.App","version":"%s"}}}\n' "$RT" > /opt/runtimeconfig.json \
 && test -f "$(ls -d /usr/share/dotnet/sdk/*/Roslyn/bincore/csc.dll | head -n1)"
