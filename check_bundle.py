with open('/workspace/projects/client/dist/_expo/static/js/web/entry-be3ec806f470821baea77f3d59553860.js', 'rb') as f:
    data = f.read()

def make_uesc(text):
    result = b''
    for c in text:
        cp = ord(c)
        result += ('\\u' + format(cp, '04X')).encode('ascii')
    return result

print("=== State buttons (should exist) ===")
for text in ['我很累', '我很乱', '我很烦', '我很空', '我说不清']:
    pattern = make_uesc(text)
    found = pattern in data
    print(f'  {"OK" if found else "MISS"} {text}')

print()
print("=== New V2 strings ===")
for text in ['我听见的东西', '切换陪伴方式', '你不需要整理好语言', 
             '发生了什么', '你心里怎么理解这件事',
             '这里可能卡住的地方', '可以先松动的一点',
             '选择一种更适合你的陪伴方式',
             '历史记录', '还没有对话记录', '开始吧',
             '我在听。', '轮到你了']:
    pattern = make_uesc(text)
    found = pattern in data
    print(f'  {"OK" if found else "MISS"} {text}')

print()
print("=== Old strings (should be gone) ===")
for text in ['欢迎来到这里', '点击切换咨询师', '深度心理分析', 
             '选择你的咨询师', '关键事件']:
    pattern = make_uesc(text)
    found = pattern in data
    print(f'  {"STILL" if found else "GONE"} {text}')

# Also try searching with raw bytes
print()
print("=== Raw byte search for partial strings ===")
# Look for any Chinese text
for text in ['切换', '陪伴', '听见', '不需要', '发生了什么']:
    target = text.encode('utf-8')
    pos = data.find(target)
    print(f'  {"FOUND" if pos >= 0 else "MISS"} {text} at pos {pos}')

# Check how the production bundle stores strings by looking at a known working one
print()
print("=== Looking for '聪明狐狸' (should exist in roles) ===")
pattern = make_uesc('聪明狐狸')
found = pattern in data
print(f'  {"OK" if found else "MISS"} 聪明狐狸')