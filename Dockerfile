FROM mcr.microsoft.com/dotnet/sdk:8.0 AS build
WORKDIR /src

COPY . ./
RUN dotnet restore "GulumsemekSadakadir.csproj"
RUN dotnet publish "GulumsemekSadakadir.csproj" -c Release -o /src/out

FROM mcr.microsoft.com/dotnet/aspnet:8.0 AS final
WORKDIR /app
COPY --from=build /src/out ./

EXPOSE 8080
ENV ASPNETCORE_URLS=http://+:8080

ENTRYPOINT ["dotnet", "GulumsemekSadakadir.dll"]
