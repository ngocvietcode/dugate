# scripts/docker-mode.ps1
# Chuyen connector URLs tu localhost -> Docker internal (truoc khi docker-compose up)
Write-Host "Switching connector URLs to DOCKER mode..." -ForegroundColor Cyan

$q = "UPDATE `"ExternalApiConnection`" SET `"endpointUrl`" = REPLACE(`"endpointUrl`", 'http://localhost:3099', 'http://mock-service:3099');"
$q | docker exec -i du-db-1 psql -U dugate -d dugate

Write-Host "Done! Connectors now point to http://mock-service:3099" -ForegroundColor Green
Write-Host "Run: docker-compose up --build" -ForegroundColor Yellow
