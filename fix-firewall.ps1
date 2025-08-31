# PowerShell script to fix Windows Firewall for Node.js server
Write-Host "🔧 Fixing Windows Firewall for Node.js Server..." -ForegroundColor Green

# Check if running as administrator
$isAdmin = ([Security.Principal.WindowsPrincipal] [Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole] "Administrator")

if (-not $isAdmin) {
    Write-Host "❌ This script needs to be run as Administrator" -ForegroundColor Red
    Write-Host "Please right-click PowerShell and select 'Run as Administrator'" -ForegroundColor Yellow
    exit 1
}

# Add firewall rule for Node.js on port 8080
Write-Host "Adding firewall rule for Node.js on port 8080..." -ForegroundColor Yellow

try {
    # Remove existing rule if it exists
    Remove-NetFirewallRule -DisplayName "Node.js Server 8080" -ErrorAction SilentlyContinue
    
    # Add new rule
    New-NetFirewallRule -DisplayName "Node.js Server 8080" `
                       -Direction Inbound `
                       -Protocol TCP `
                       -LocalPort 8080 `
                       -Action Allow `
                       -Profile Any `
                       -Description "Allow Node.js server on port 8080"

    Write-Host "✅ Firewall rule added successfully!" -ForegroundColor Green
} catch {
    Write-Host "❌ Failed to add firewall rule: $($_.Exception.Message)" -ForegroundColor Red
}

# Check current IP address
Write-Host "`n🌐 Current Network Information:" -ForegroundColor Cyan
$ipAddress = (Get-NetIPAddress -AddressFamily IPv4 | Where-Object {$_.IPAddress -like "192.168.*"}).IPAddress
if ($ipAddress) {
    Write-Host "Your IP Address: $ipAddress" -ForegroundColor Green
    Write-Host "Server should be accessible at: http://$ipAddress`:8080" -ForegroundColor Green
} else {
    Write-Host "Could not determine your IP address" -ForegroundColor Yellow
}

# Test if port 8080 is listening
Write-Host "`n🔍 Checking if port 8080 is listening..." -ForegroundColor Cyan
$listening = Get-NetTCPConnection -LocalPort 8080 -ErrorAction SilentlyContinue
if ($listening) {
    Write-Host "✅ Port 8080 is listening" -ForegroundColor Green
    Write-Host "State: $($listening.State)" -ForegroundColor Green
} else {
    Write-Host "❌ Port 8080 is not listening" -ForegroundColor Red
    Write-Host "Make sure your Node.js server is running" -ForegroundColor Yellow
}

Write-Host "`n🎉 Firewall configuration complete!" -ForegroundColor Green
Write-Host "Try connecting from your React Native app now." -ForegroundColor Green
