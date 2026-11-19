import { Children, Fragment, isValidElement, type ReactNode } from "react";
import * as Primitive from "@radix-ui/react-select";
import { Check, ChevronDown, ChevronUp } from "lucide-react";

type Option = { value: string; label: ReactNode; disabled: boolean };
function optionsFrom(children: ReactNode): Option[] {
  return Children.toArray(children).flatMap(child => {
    if (!isValidElement<{ value?: string | number; children?: ReactNode; disabled?: boolean }>(child)) return [];
    if (child.type === Fragment) return optionsFrom(child.props.children);
    if (child.type !== "option") return [];
    return [{ value: String(child.props.value ?? ""), label: child.props.children, disabled: Boolean(child.props.disabled) }];
  });
}
export function Select({ value, onValueChange, children, className = "", title, disabled, id, name, "aria-label": label }: {
  value: string | number; onValueChange: (value: string) => void; children: ReactNode;
  className?: string; title?: string; disabled?: boolean; id?: string; name?: string; "aria-label"?: string;
}) {
  const options = optionsFrom(children);
  // Prefix every value so an empty application value remains a real selectable item.
  return <Primitive.Root value={"v:" + value} onValueChange={v => onValueChange(v.slice(2))} disabled={disabled} name={name}>
    <Primitive.Trigger id={id} className={"soda-select " + className} title={title} aria-label={label ?? title ?? "选择选项"}>
      <Primitive.Value placeholder="请选择" /><Primitive.Icon className="soda-select-chevron"><ChevronDown size={14} /></Primitive.Icon>
    </Primitive.Trigger>
    <Primitive.Portal>
      <Primitive.Content className="soda-select-popup" position="popper" sideOffset={7} collisionPadding={12}>
        <Primitive.ScrollUpButton className="soda-select-scroll"><ChevronUp size={15} /></Primitive.ScrollUpButton>
        <Primitive.Viewport className="soda-select-options">
          {options.map(option => <Primitive.Item key={option.value} value={"v:" + option.value} disabled={option.disabled} className="soda-select-option">
            <Primitive.ItemText>{option.label}</Primitive.ItemText><Primitive.ItemIndicator className="soda-select-check"><Check size={15} /></Primitive.ItemIndicator>
          </Primitive.Item>)}
        </Primitive.Viewport>
        <Primitive.ScrollDownButton className="soda-select-scroll"><ChevronDown size={15} /></Primitive.ScrollDownButton>
      </Primitive.Content>
    </Primitive.Portal>
  </Primitive.Root>;
}