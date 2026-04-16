with open("api/llm-logger.ts", "r") as f:
    content = f.read()

content = content.replace(
    "errorCode?: string;\n}",
    "errorCode?: string;\n  segmentIndex?: number;\n}"
)

# Update insert call
insert_target = """        error_code: params.errorCode || null,"""
insert_replacement = """        error_code: params.errorCode || null,
        segment_index: params.segmentIndex,"""

content = content.replace(insert_target, insert_replacement)

with open("api/llm-logger.ts", "w") as f:
    f.write(content)
print("Logger patched")
