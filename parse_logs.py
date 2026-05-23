import os, re

os.makedirs(r'd:\watersafeV2\results-log', exist_ok=True)

with open(r'd:\watersafeV2\docs\9-4-26.txt', 'r', encoding='utf-8') as f:
    lines = f.readlines()

output = []
output.append('Time_s,Temp_C,TDS_ppm,Turbidity_NTU,Turbidity_V,MSE,Verdict,Confidence_pct,Reason')

for line in lines:
    if '|' not in line or '--------' in line or 'Time(s)' in line: 
        continue
    parts = [p.strip() for p in line.split('|')]
    if len(parts) >= 8:
        t = parts[0].strip()
        temp = parts[1].replace('C','').strip()
        tds = parts[2].replace('ppm','').strip()
        
        turb_match = re.search(r'(\d+)\s*NTU\s*\[(.*?)\s*V\]', parts[3])
        turb_ntu = turb_match.group(1) if turb_match else parts[3]
        turb_v = turb_match.group(2) if turb_match else ''
        
        mse = parts[4].replace('MSE:', '').strip()
        verdict = parts[5].replace('[','').replace(']','').strip()
        conf = parts[6].replace('Conf:', '').replace('%', '').strip()
        reason = parts[7].strip()
        
        output.append(f"{t},{temp},{tds},{turb_ntu},{turb_v},{mse},{verdict},{conf},{reason}")

with open(r'd:\watersafeV2\results-log\raw_telemetry_2026-04-09.csv', 'w', encoding='utf-8') as f:
    f.write('\n'.join(output))

print('Done writing CSV')
