with open("api/agent/next-step.ts", "r") as f:
    lines = f.readlines()

with open("scratch/next-step-stream.ts", "r") as f:
    replacement = f.read()

start_idx = -1
end_idx = -1
for i, line in enumerate(lines):
    if "const ai = getAI();" in line and start_idx == -1:
        start_idx = i
    if "return new Response(" in line and start_idx != -1:
        end_idx = i + 1

if start_idx != -1 and end_idx != -1:
    new_lines = lines[:start_idx] + [replacement] + lines[end_idx:]
    with open("api/agent/next-step.ts", "w") as f:
        f.writelines(new_lines)
    print("Patched!")
else:
    print("Could not find boundaries")
