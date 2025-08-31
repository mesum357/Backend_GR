Write-Host "🧪 Testing server connection..." -ForegroundColor Yellow

try {
    $response = Invoke-WebRequest -Uri "http://192.168.1.14:8080/api/health" -Method GET -TimeoutSec 5
    Write-Host "✅ SUCCESS! Server is accessible: $($response.Content)" -ForegroundColor Green
    Write-Host "🎉 Your mobile app should work now!" -ForegroundColor Green
} catch {
    Write-Host "❌ FAILED: $($_.Exception.Message)" -ForegroundColor Red
    Write-Host "🔧 Please check Windows Firewall settings" -ForegroundColor Yellow
}
