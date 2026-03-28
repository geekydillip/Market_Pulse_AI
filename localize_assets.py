
import os
import requests
import re

# Configuration
BASE_DIR = 'public/lib'
ASSETS = {
    'tailwind.min.js': 'https://cdn.tailwindcss.com',
    'echarts.min.js': 'https://cdn.jsdelivr.net/npm/echarts@5.4.3/dist/echarts.min.js',
    'font-awesome/css/all.min.css': 'https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.5.0/css/all.min.css',
    'xlsx.full.min.js': 'https://cdn.sheetjs.com/xlsx-0.20.1/package/dist/xlsx.full.min.js',
    'chart.umd.js': 'https://cdnjs.cloudflare.com/ajax/libs/Chart.js/4.4.1/chart.umd.js',
}

FONTS = {
    'fonts/jetbrains-mono-400.ttf': 'https://fonts.gstatic.com/s/jetbrainsmono/v24/tDbY2o-flEEny0FZhsfKu5WU4zr3E_BX0PnT8RD8yKxjPQ.ttf',
    'fonts/jetbrains-mono-500.ttf': 'https://fonts.gstatic.com/s/jetbrainsmono/v24/tDbY2o-flEEny0FZhsfKu5WU4zr3E_BX0PnT8RD8-qxjPQ.ttf',
    'fonts/jetbrains-mono-600.ttf': 'https://fonts.gstatic.com/s/jetbrainsmono/v24/tDbY2o-flEEny0FZhsfKu5WU4zr3E_BX0PnT8RD8FqtjPQ.ttf',
    'fonts/sora-300.ttf': 'https://fonts.gstatic.com/s/sora/v17/xMQOuFFYT72X5wkB_18qmnndmScMnn-K.ttf',
    'fonts/sora-400.ttf': 'https://fonts.gstatic.com/s/sora/v17/xMQOuFFYT72X5wkB_18qmnndmSdSnn-K.ttf',
    'fonts/sora-500.ttf': 'https://fonts.gstatic.com/s/sora/v17/xMQOuFFYT72X5wkB_18qmnndmSdgnn-K.ttf',
    'fonts/sora-600.ttf': 'https://fonts.gstatic.com/s/sora/v17/xMQOuFFYT72X5wkB_18qmnndmSeMmX-K.ttf',
    'fonts/sora-700.ttf': 'https://fonts.gstatic.com/s/sora/v17/xMQOuFFYT72X5wkB_18qmnndmSe1mX-K.ttf',
    # Inter (used in aiprocessor.html)
    'fonts/inter-400.ttf': 'https://fonts.gstatic.com/s/inter/v20/UcCO3FwrK3iLTeHuS_nVMrMxCp50SjIw2boKoduKmMEVuLyfMZg.ttf',
    'fonts/inter-500.ttf': 'https://fonts.gstatic.com/s/inter/v20/UcCO3FwrK3iLTeHuS_nVMrMxCp50SjIw2boKoduKmMEVuI6fMZg.ttf',
    'fonts/inter-600.ttf': 'https://fonts.gstatic.com/s/inter/v20/UcCO3FwrK3iLTeHuS_nVMrMxCp50SjIw2boKoduKmMEVuGKYMZg.ttf',
    'fonts/inter-700.ttf': 'https://fonts.gstatic.com/s/inter/v20/UcCO3FwrK3iLTeHuS_nVMrMxCp50SjIw2boKoduKmMEVuFuYMZg.ttf',
    # FontAwesome Webfonts (saved relative to css folder)
    'font-awesome/webfonts/fa-solid-900.woff2': 'https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.5.0/webfonts/fa-solid-900.woff2',
    'font-awesome/webfonts/fa-regular-400.woff2': 'https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.5.0/webfonts/fa-regular-400.woff2',
    'font-awesome/webfonts/fa-brands-400.woff2': 'https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.5.0/webfonts/fa-brands-400.woff2',
    # DM Sans
    'fonts/dm-sans-400.ttf': 'https://fonts.gstatic.com/s/dmsans/v17/rP2tp2ywxg089UriI5-g4vlH9VoD8CmcqZG40F9JadbnoEwAopxhTg.ttf',
    'fonts/dm-sans-500.ttf': 'https://fonts.gstatic.com/s/dmsans/v17/rP2tp2ywxg089UriI5-g4vlH9VoD8CmcqZG40F9JadbnoEwAkJxhTg.ttf',
    'fonts/dm-sans-700.ttf': 'https://fonts.gstatic.com/s/dmsans/v17/rP2tp2ywxg089UriI5-g4vlH9VoD8CmcqZG40F9JadbnoEwARZthTg.ttf',
    # DM Mono
    'fonts/dm-mono-400.ttf': 'https://fonts.gstatic.com/s/dmmono/v16/aFTU7PB1QTsUX8KYhh0.ttf',
    'fonts/dm-mono-500.ttf': 'https://fonts.gstatic.com/s/dmmono/v16/aFTR7PB1QTsUX8KYvumzIYQ.ttf',
}

def download_file(url, path):
    print(f"Downloading {url} to {path}...")
    try:
        response = requests.get(url, stream=True)
        response.raise_for_status()
        os.makedirs(os.path.dirname(path), exist_ok=True)
        with open(path, 'wb') as f:
            for chunk in response.iter_content(chunk_size=8192):
                f.write(chunk)
        print("Done.")
    except Exception as e:
        print(f"Failed to download {url}: {e}")

def main():
    # 1. JS/CSS
    for target, url in ASSETS.items():
        path = os.path.join(BASE_DIR, target)
        download_file(url, path)

    # 2. Fonts
    for target, url in FONTS.items():
        path = os.path.join(BASE_DIR, target)
        download_file(url, path)

    print("\nAssets downloaded successfully.")

if __name__ == '__main__':
    main()
