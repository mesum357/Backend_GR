# Check and configure Windows Firewall for Node.js server
Write-Host "🔍 Checking Windows Firewall..." -ForegroundColor Yellow

# Check if port 8080 is open
$portCheck = netstat -an | findstr ":8080"
Write-Host "📊 Port 8080 status:" -ForegroundColor Cyan
Write-Host $portCheck

# Check firewall rules
Write-Host "`n🔍 Checking existing firewall rules..." -ForegroundColor Yellow
Get-NetFirewallRule | Where-Object { $_.DisplayName -like "*Node*" -or $_.DisplayName -like "*8080*" } | Format-Table DisplayName, Enabled, Direction, Action

# Add firewall rule for Node.js
Write-Host "`n🔧 Adding firewall rule for Node.js on port 8080..." -ForegroundColor Yellow
try {
    New-NetFirewallRule -DisplayName "Node.js Server 8080" -Direction Inbound -Protocol TCP -LocalPort 8080 -Action Allow -Profile Any
    Write-Host "✅ Firewall rule added successfully!" -ForegroundColor Green
} catch {
    Write-Host "⚠️  Firewall rule might already exist or requires admin privileges" -ForegroundColor Yellow
}

# Test local connection
Write-Host "`n🧪 Testing local connection..." -ForegroundColor Yellow
try {
    $response = Invoke-WebRequest -Uri "http://localhost:8080/api/health" -Method GET -TimeoutSec 5
    Write-Host "✅ Local connection successful: $($response.Content)" -ForegroundColor Green
} catch {
    Write-Host "❌ Local connection failed: $($_.Exception.Message)" -ForegroundColor Red
}

# Test network connection
Write-Host "`n🧪 Testing network connection..." -ForegroundColor Yellow
try {
    $response = Invoke-WebRequest -Uri "http://192.168.1.14:8080/api/health" -Method GET -TimeoutSec 5
    Write-Host "✅ Network connection successful: $($response.Content)" -ForegroundColor Green
} catch {
    Write-Host "❌ Network connection failed: $($_.Exception.Message)" -ForegroundColor Red
}

Write-Host "`n📋 Summary:" -ForegroundColor Cyan
Write-Host "- Server should be running on port 8080" -ForegroundColor White
Write-Host "- Firewall rule added for inbound connections" -ForegroundColor White
Write-Host "- Mobile app should connect to: http://192.168.1.14:8080" -ForegroundColor White
